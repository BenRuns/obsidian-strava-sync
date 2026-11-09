import { zipSync } from "fflate";
import {
  type FitActivity,
  FitImporter,
  type FitSession,
  extractFitFiles,
  parseFitFile,
  sessionToActivity,
  utcOffsetSeconds,
} from "../FitImporter";
import { calorieProfile } from "../Settings";
import { RUN, START, buildFitFile, steadyRecords } from "./fitFiles";

describe("FitImporter", () => {
  it("reads an activity from a FIT file", async () => {
    const [activity] = await parseFitFile(buildFitFile([RUN]));

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

  it("makes one activity per session in a multisport file", async () => {
    const bikeStart = new Date(START.getTime() + 1800 * 1000);
    const activities = await parseFitFile(
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

  it("uses zero for values the file doesn't have", async () => {
    const [activity] = await parseFitFile(
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
    ["running", "virtual_activity", "VirtualRun"],
    ["cycling", undefined, "Ride"],
    ["cycling", "mountain", "MountainBikeRide"],
    ["cycling", "gravel_cycling", "GravelRide"],
    ["cycling", "indoor_cycling", "VirtualRide"],
    ["e_biking", undefined, "EBikeRide"],
    ["swimming", undefined, "Swim"],
    ["hiking", undefined, "Hike"],
    ["alpine_skiing", "backcountry", "BackcountrySki"],
    ["training", "strength_training", "WeightTraining"],
    ["training", "yoga", "Yoga"],
    ["fitness_equipment", "indoor_rowing", "Rowing"],
    ["fitness_equipment", "elliptical", "Elliptical"],
    ["boxing", undefined, "Workout"],
  ])("maps sport %s / %s to %s", (sport, subSport, expected) => {
    const activity = sessionToActivity({
      start_time: START,
      sport,
      sub_sport: subSport,
    } as FitSession);

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
      sessionToActivity({
        start_time: startTime,
        sport: "running",
      } as FitSession).name,
    ).toBe(name);
  });

  it("reads the device's local time from the file", async () => {
    // 07:30 UTC, recorded 7 hours behind UTC: 00:30 local.
    const [activity] = await parseFitFile(
      buildFitFile([{ startTime: START, sport: "running" }], {
        utcOffsetSeconds: -7 * 3600,
      }),
    );

    expect(activity.name).toBe("Night Run");
  });

  it("names activities by the time where they were recorded", () => {
    // 18:31 UTC, recorded 6 hours behind UTC: 12:31 local.
    const startTime = new Date("2022-08-29T18:31:22Z");

    expect(
      sessionToActivity(
        { start_time: startTime, sport: "walking" } as FitSession,
        -21600,
      ).name,
    ).toBe("Afternoon Walk");
  });

  it("reads the UTC offset from the activity message", () => {
    const timestamp = new Date("2022-08-29T18:36:45Z");

    expect(
      utcOffsetSeconds({
        timestamp,
        local_timestamp: new Date("2022-08-29T12:36:45Z"),
      } as FitActivity),
    ).toBe(-21600);
    expect(utcOffsetSeconds({ timestamp } as FitActivity)).toBeUndefined();
    expect(utcOffsetSeconds(undefined)).toBeUndefined();
  });

  it("splits multi-word sport types in names", () => {
    const startTime = new Date(2026, 9, 25, 9, 0);

    expect(
      sessionToActivity({
        start_time: startTime,
        sport: "cycling",
        sub_sport: "mountain",
      } as FitSession).name,
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

    it("imports every FIT file in a zip", async () => {
      const bikeStart = new Date(START.getTime() + 86400 * 1000);
      const result = await new FitImporter([
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

    it("names files inside the zip in errors", async () => {
      const result = await new FitImporter([
        {
          name: "export.zip",
          data: zip({ "broken.fit": "not a fit file at all" }),
        },
      ]).import();

      expect(result.errors).toEqual([
        {
          file: "export.zip/broken.fit",
          message: expect.stringMatching(/^Not a FIT file/),
        },
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
    it("rejects files that aren't FIT", async () => {
      const data = new TextEncoder().encode("not a fit file at all")
        .buffer as ArrayBuffer;

      await expect(parseFitFile(data)).rejects.toThrow("Not a FIT file");
    });

    it("rejects damaged files", async () => {
      const data = buildFitFile([RUN]);
      new Uint8Array(data)[20] ^= 0xff;

      await expect(parseFitFile(data)).rejects.toThrow("The file is damaged");
    });

    it("rejects files without an activity", async () => {
      await expect(parseFitFile(buildFitFile([]))).rejects.toThrow(
        "no sessions",
      );
    });

    it("reports bad files and imports the rest", async () => {
      const result = await new FitImporter([
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

describe("estimated calories", () => {
  const profile = { sex: "male" as const, birthYear: 1991, weightKg: 75 };
  const RIDE = { ...RUN, sport: "cycling", subSport: undefined };

  it("estimates calories from heart rate, alongside the device's", async () => {
    const [activity] = await parseFitFile(
      buildFitFile([RUN], { records: steadyRecords(3600, { heartRate: 150 }) }),
      profile,
    );

    expect(activity.calories).toBe(700);
    expect(activity.estimated_calories).toBe(882);
    expect(activity.active_calories).toBe(803);
    expect(activity.calories_method).toBe("heart_rate");
  });

  it("estimates calories from power for rides", async () => {
    const [activity] = await parseFitFile(
      buildFitFile([RIDE], {
        records: steadyRecords(3600, { heartRate: 150, power: 200 }),
      }),
      profile,
    );

    expect(activity.estimated_calories).toBe(717);
    expect(activity.calories_method).toBe("power");
  });

  it("estimates each leg of a multisport file from its own records", async () => {
    const bikeStart = new Date(START.getTime() + 3600 * 1000);
    const [run, ride] = await parseFitFile(
      buildFitFile(
        [
          { ...RUN, totalElapsedTime: 3600 },
          { ...RIDE, startTime: bikeStart, totalElapsedTime: 3600 },
        ],
        {
          records: [
            ...steadyRecords(3600, { heartRate: 150 }),
            ...steadyRecords(3600, { power: 200 }, bikeStart).slice(1),
          ],
        },
      ),
      profile,
    );

    expect(run.calories_method).toBe("heart_rate");
    expect(ride.calories_method).toBe("power");
    expect(ride.estimated_calories).toBe(717);
  });

  it("leaves estimates out without a profile or enough data", async () => {
    const withRecords = buildFitFile([RUN], {
      records: steadyRecords(3600, { heartRate: 150 }),
    });
    const [noProfile] = await parseFitFile(withRecords);
    const [noRecords] = await parseFitFile(buildFitFile([RUN]), profile);

    for (const activity of [noProfile, noRecords]) {
      expect(activity).not.toHaveProperty("estimated_calories");
      expect(activity).not.toHaveProperty("active_calories");
      expect(activity).not.toHaveProperty("calories_method");
    }
  });

  it("passes the profile through FitImporter", async () => {
    const { activities } = await new FitImporter(
      [
        {
          name: "run.fit",
          data: buildFitFile([RUN], {
            records: steadyRecords(3600, { heartRate: 150 }),
          }),
        },
      ],
      profile,
    ).import();

    expect(activities[0].estimated_calories).toBe(882);
  });
});

describe("calorieProfile", () => {
  it("needs sex, birth year and weight", () => {
    expect(calorieProfile({ weightUnit: "kg" })).toBeUndefined();
    expect(
      calorieProfile({ sex: "female", birthYear: 1990, weightUnit: "kg" }),
    ).toBeUndefined();
    expect(
      calorieProfile({
        sex: "female",
        birthYear: 1990,
        weight: 60,
        weightUnit: "kg",
      }),
    ).toEqual({
      sex: "female",
      birthYear: 1990,
      weightKg: 60,
      vo2max: undefined,
    });
  });

  it("converts pounds, and keeps VO2 max", () => {
    expect(
      calorieProfile({
        sex: "male",
        birthYear: 1990,
        weight: 165,
        weightUnit: "lb",
        vo2max: 52,
      }),
    ).toEqual({
      sex: "male",
      birthYear: 1990,
      weightKg: expect.closeTo(74.84, 2),
      vo2max: 52,
    });
  });
});
