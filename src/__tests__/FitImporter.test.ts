import type { ActivityMesg, SessionMesg } from "@garmin/fitsdk";
import { zipSync } from "fflate";
import {
  FitImporter,
  extractFitFiles,
  parseFitFile,
  sessionToActivity,
  utcOffsetSeconds,
} from "../FitImporter";
import { RUN, START, buildFitFile } from "./fitFiles";

describe("FitImporter", () => {
  it("reads an activity from a FIT file", () => {
    const [activity] = parseFitFile(buildFitFile([RUN]));

    expect(activity).toEqual({
      id: START.getTime() / 1000,
      start_date: START,
      name: expect.stringMatching(/ Trail Run$/),
      sport_type: "TrailRun",
      description: "",
      private_note: "",
      elapsed_time: 3700,
      moving_time: 3600,
      distance: 10000,
      max_heart_rate: 175,
      max_speed: 4.1,
      average_speed: 2.78,
      total_elevation_gain: 120,
      elev_low: 50,
      elev_high: 170,
      calories: 700,
      source: "FIT",
    });
  });

  it("makes one activity per session in a multisport file", () => {
    const bikeStart = new Date(START.getTime() + 1800 * 1000);
    const activities = parseFitFile(
      buildFitFile([
        { startTime: START, sport: "swimming", totalElapsedTime: 1800 },
        { startTime: bikeStart, sport: "cycling", totalElapsedTime: 3600 },
      ]),
    );

    expect(activities.map((activity) => activity.sport_type)).toEqual([
      "Swim",
      "Ride",
    ]);
    expect(activities[1].id).toBe(bikeStart.getTime() / 1000);
  });

  it("uses zero for values the file doesn't have", () => {
    const [activity] = parseFitFile(
      buildFitFile([{ startTime: START, sport: "training" }]),
    );

    expect(activity.sport_type).toBe("Workout");
    expect(activity.distance).toBe(0);
    expect(activity.max_heart_rate).toBe(0);
    expect(activity.calories).toBe(0);
  });

  it.each([
    ["running", undefined, "Run"],
    ["running", "trail", "TrailRun"],
    ["running", "virtualActivity", "VirtualRun"],
    ["cycling", undefined, "Ride"],
    ["cycling", "mountain", "MountainBikeRide"],
    ["cycling", "gravelCycling", "GravelRide"],
    ["cycling", "indoorCycling", "VirtualRide"],
    ["eBiking", undefined, "EBikeRide"],
    ["swimming", undefined, "Swim"],
    ["hiking", undefined, "Hike"],
    ["alpineSkiing", "backcountry", "BackcountrySki"],
    ["training", "strengthTraining", "WeightTraining"],
    ["training", "yoga", "Yoga"],
    ["fitnessEquipment", "indoorRowing", "Rowing"],
    ["fitnessEquipment", "elliptical", "Elliptical"],
    ["boxing", undefined, "Workout"],
  ])("maps sport %s / %s to %s", (sport, subSport, expected) => {
    const activity = sessionToActivity({
      startTime: START,
      sport,
      subSport,
    } as SessionMesg);

    expect(activity.sport_type).toBe(expected);
  });

  it.each([
    [7, "Morning Run"],
    [13, "Afternoon Run"],
    [18, "Evening Run"],
    [23, "Night Run"],
    [3, "Night Run"],
  ])("names a run starting at %i:00 %s", (hour, name) => {
    const startTime = new Date(2026, 9, 25, hour, 0);

    expect(
      sessionToActivity({ startTime, sport: "running" } as SessionMesg).name,
    ).toBe(name);
  });

  it("names activities by the time where they were recorded", () => {
    // 18:31 UTC, recorded 6 hours behind UTC: 12:31 local.
    const startTime = new Date("2022-08-29T18:31:22Z");

    expect(
      sessionToActivity({ startTime, sport: "walking" } as SessionMesg, -21600)
        .name,
    ).toBe("Afternoon Walk");
  });

  it("reads the UTC offset from the activity message", () => {
    const timestamp = new Date("2022-08-29T18:36:45Z");

    expect(
      utcOffsetSeconds({
        timestamp,
        localTimestamp: 1030711005,
      } as ActivityMesg),
    ).toBe(-21600);
    expect(utcOffsetSeconds({ timestamp } as ActivityMesg)).toBeUndefined();
    expect(utcOffsetSeconds(undefined)).toBeUndefined();
  });

  it("splits multi-word sport types in names", () => {
    const startTime = new Date(2026, 9, 25, 9, 0);

    expect(
      sessionToActivity({
        startTime,
        sport: "cycling",
        subSport: "mountain",
      } as SessionMesg).name,
    ).toBe("Morning Mountain Bike Ride");
  });

  describe("zip files", () => {
    const zip = (files: Record<string, ArrayBuffer | string>) => {
      const bytes = zipSync(
        Object.fromEntries(
          Object.entries(files).map(([name, content]) => [
            name,
            typeof content === "string"
              ? new TextEncoder().encode(content)
              : new Uint8Array(content),
          ]),
        ),
      );
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    };

    it("imports every FIT file in a zip", () => {
      const bikeStart = new Date(START.getTime() + 86400 * 1000);
      const result = new FitImporter([
        {
          name: "export.zip",
          data: zip({
            "run.fit": buildFitFile([RUN]),
            "rides/ride.FIT": buildFitFile([
              { startTime: bikeStart, sport: "cycling" },
            ]),
            "readme.txt": "not an activity",
          }),
        },
      ]).import();

      expect(result.errors).toEqual([]);
      expect(result.activities.map((activity) => activity.sport_type)).toEqual([
        "TrailRun",
        "Ride",
      ]);
    });

    it("names files inside the zip in errors", () => {
      const result = new FitImporter([
        {
          name: "export.zip",
          data: zip({ "broken.fit": "not a fit file at all" }),
        },
      ]).import();

      expect(result.errors).toEqual([
        { file: "export.zip/broken.fit", message: "Not a FIT file" },
      ]);
    });

    it("reports a zip without FIT files", () => {
      expect(() =>
        extractFitFiles({
          name: "photos.zip",
          data: zip({ "photo.jpg": "jpeg" }),
        }),
      ).toThrow("The zip file has no .fit files");
    });

    it("passes plain FIT files through", () => {
      const file = { name: "run.fit", data: buildFitFile([RUN]) };

      expect(extractFitFiles(file)).toEqual([file]);
    });
  });

  describe("errors", () => {
    it("rejects files that aren't FIT", () => {
      const data = new TextEncoder().encode("not a fit file at all")
        .buffer as ArrayBuffer;

      expect(() => parseFitFile(data)).toThrow("Not a FIT file");
    });

    it("rejects damaged files", () => {
      const data = buildFitFile([RUN]);
      new Uint8Array(data)[20] ^= 0xff;

      expect(() => parseFitFile(data)).toThrow("integrity check failed");
    });

    it("rejects files without an activity", () => {
      expect(() => parseFitFile(buildFitFile([]))).toThrow("no sessions");
    });

    it("reports bad files and imports the rest", () => {
      const result = new FitImporter([
        { name: "run.fit", data: buildFitFile([RUN]) },
        { name: "settings.fit", data: buildFitFile([]) },
      ]).import();

      expect(result.activities).toHaveLength(1);
      expect(result.errors).toEqual([
        {
          file: "settings.fit",
          message: "No activity found (the file has no sessions)",
        },
      ]);
    });
  });
});
