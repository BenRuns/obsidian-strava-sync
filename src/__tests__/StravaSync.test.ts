import * as fs from "node:fs";
import * as path from "node:path";

import {
  App,
  Notice,
  type PluginManifest,
  Vault,
  requireApiVersion,
} from "obsidian";
import { DEFAULT_TEMPLATE, LEGACY_DEFAULT_TEMPLATE } from "../ActivityRenderer";
import { GarminApiError } from "../GarminApi";
import StravaSync from "../StravaSync";
import { RUN, buildFitFile } from "./fitFiles";

jest.mock("obsidian");

const mockGarminImport = jest.fn();
jest.mock("../GarminActivityImporter", () => ({
  GarminActivityImporter: jest.fn().mockImplementation(() => ({
    importLatestActivities: mockGarminImport,
  })),
}));

jest.mock("../ActivityImporter", () => ({
  ActivityImporter: jest.fn().mockImplementation(() => ({
    importLatestActivities: jest.fn().mockResolvedValue([
      {
        id: 12345678,
        name: "Morning Run",
        type: "Run",
        start_date: new Date("2023-04-16T08:00:00Z"),
        elapsed_time: 1800,
        distance: 5000,
        max_heart_rate: 175,
      },
      {
        id: 12345679,
        name: "Evening Ride",
        type: "Ride",
        start_date: new Date("2023-04-16T18:00:00Z"),
        elapsed_time: 3600,
        distance: 20000,
        max_heart_rate: 165,
      },
    ]),
  })),
}));

jest.mock("../FileSelector", () => ({
  FileSelector: jest.fn().mockImplementation(() => ({
    selectFiles: jest.fn(),
    selectContents: jest
      .fn()
      .mockResolvedValue(
        fs.readFileSync(
          path.join(__dirname, "../../assets/activities.csv"),
          "utf8",
        ),
      ),
  })),
}));

jest.mock("../ActivitySerializer", () => ({
  ActivitySerializer: jest.fn().mockImplementation(() => ({
    serialize: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock("../StravaApi", () => ({
  StravaApi: jest.fn().mockImplementation(() => ({
    isAuthenticated: jest.fn().mockReturnValue(true),
    listActivities: jest.fn().mockResolvedValue([]),
  })),
}));

describe("StravaSync", () => {
  let plugin: StravaSync;
  let app: App;
  let vault: Vault;
  let mockManifest: PluginManifest;

  beforeEach(() => {
    app = new App();
    vault = new Vault();
    app.vault = vault;

    mockManifest = {
      id: "strava-sync",
      name: "Strava Sync",
      version: "1.0.0",
      minAppVersion: "0.15.0",
      description: "Sync Strava activities to Obsidian",
      author: "Your Name",
      authorUrl: "https://github.com/yourusername",
      isDesktopOnly: false,
    };

    plugin = new StravaSync(app, mockManifest);

    // Call onload to initialize fileSelector and activitySerializer
    plugin.onload();
  });

  test("Import activities CSV", async () => {
    await plugin.importActivitiesFromCSV();

    expect(plugin.fileSelector.selectContents).toHaveBeenCalledTimes(1);
    expect(plugin.activitySerializer.serialize).toHaveBeenCalledTimes(3);

    const serializedActivities = (
      plugin.activitySerializer.serialize as jest.Mock
    ).mock.calls.map((call) => call[0]);

    expect(serializedActivities[0]).toMatchObject({
      id: 12271989718,
      name: "Lunch Run",
      sport_type: "Run",
      start_date: expect.any(Date),
      elapsed_time: 1955,
      distance: 4551.31982421875,
      max_heart_rate: 165,
      private_note: "Light run. Knee pain 2/10.",
    });

    expect(serializedActivities[1]).toMatchObject({
      id: 12288940553,
      name: "Dynamo Challenge 2024",
      sport_type: "Ride",
      start_date: expect.any(Date),
      elapsed_time: 23198,
      distance: 93131.53125,
      max_heart_rate: 182,
      private_note: "Hand numbness 4/10.",
    });

    expect(serializedActivities[2]).toMatchObject({
      id: 12315055573,
      name: "Lunch Swim",
      sport_type: "Swim",
      start_date: expect.any(Date),
      elapsed_time: 1697,
      distance: 1000,
      max_heart_rate: 158,
    });

    expect(Notice).toHaveBeenCalledWith(
      "🏃 3 activities created.",
      expect.any(Number),
    );
  });

  test("Import activities from FIT files", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (plugin.fitFileSelector.selectFiles as jest.Mock).mockResolvedValue([
      { name: "run.fit", data: buildFitFile([RUN]) },
      { name: "notes.txt", data: new ArrayBuffer(8) },
    ]);

    await plugin.importActivitiesFromFIT();

    expect(plugin.activitySerializer.serialize).toHaveBeenCalledTimes(1);
    expect(plugin.activitySerializer.serialize).toHaveBeenCalledWith(
      expect.objectContaining({ sport_type: "TrailRun", distance: 10000 }),
    );
    expect(Notice).toHaveBeenCalledWith(
      "🏃 1 activities created.",
      expect.any(Number),
    );
    expect(Notice).toHaveBeenCalledWith(
      expect.stringMatching(
        /^🛑 1 of 2 FIT files could not be imported:\n\nnotes.txt: Not a FIT file/,
      ),
      expect.any(Number),
    );
  });

  test("Import new activities", async () => {
    jest
      .spyOn(plugin.activitySerializer, "serialize")
      .mockImplementation((activity) => {
        return Promise.resolve(activity.id === 12345678);
      });

    await plugin.importNewActivities();

    expect(plugin.stravaApi.isAuthenticated).toHaveBeenCalled();
    expect(plugin.activitySerializer.serialize).toHaveBeenCalledTimes(2);
    expect(plugin.settings.sync.lastActivityTimestamp).toBe(
      Math.floor(new Date("2023-04-16T18:00:00Z").getTime() / 1000),
    );

    expect(Notice).toHaveBeenCalledWith(
      "🏃 1 new activities created, 1 already existing.",
      expect.any(Number),
    );
  });

  describe("with Garmin as the source", () => {
    const secrets: Record<string, string> = {};

    const garminActivity = (startTime: string) => ({
      id: Date.parse(startTime) / 1000,
      name: "Run",
      start_date: new Date(startTime),
      source: "Garmin",
    });

    beforeEach(async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      mockGarminImport.mockReset();
      for (const key of Object.keys(secrets)) delete secrets[key];
      Object.assign(app, {
        secretStorage: {
          getSecret: (id: string) => secrets[id] ?? null,
          setSecret: (id: string, value: string) => {
            secrets[id] = value;
          },
        },
      });
      await plugin.loadSettings();
      plugin.settings.sync.source = "garmin";
      await plugin.setGarminApiKey(" garmin-key ");
    });

    test("imports from Garmin, not Strava", async () => {
      mockGarminImport.mockResolvedValue({
        activities: [
          garminActivity("2026-10-25T07:30:00Z"),
          garminActivity("2026-10-26T07:30:00Z"),
        ],
        errors: [],
      });

      await plugin.importNewActivities();

      expect(plugin.activitySerializer.serialize).toHaveBeenCalledTimes(2);
      expect(plugin.settings.sync.lastGarminActivityTimestamp).toBe(
        Date.parse("2026-10-26T07:30:00Z") / 1000,
      );
      expect(plugin.settings.sync.lastActivityTimestamp).toBeUndefined();
      expect(Notice).toHaveBeenCalledWith(
        "🏃 2 new activities created.",
        expect.any(Number),
      );
    });

    test("doesn't move on when an activity fails", async () => {
      plugin.settings.sync.lastGarminActivityTimestamp = 100;
      mockGarminImport.mockResolvedValue({
        activities: [garminActivity("2026-10-26T07:30:00Z")],
        errors: [{ file: "Garmin activity 1", message: "HTTP 500" }],
      });

      await plugin.importNewActivities();

      expect(plugin.activitySerializer.serialize).toHaveBeenCalledTimes(1);
      expect(plugin.settings.sync.lastGarminActivityTimestamp).toBe(100);
      expect(Notice).toHaveBeenCalledWith(
        "🛑 1 Garmin activities could not be imported and will be tried again next time. Check the console for details.",
        expect.any(Number),
      );
    });

    test("asks for an API key first", async () => {
      await plugin.setGarminApiKey("");

      await plugin.importNewActivities();

      expect(mockGarminImport).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        "🛑 Please add your Garmin API key in the plugin settings.",
        expect.any(Number),
      );
    });

    test("shows Garmin's errors", async () => {
      mockGarminImport.mockRejectedValue(
        new GarminApiError("Garmin rejected the API key."),
      );

      await plugin.importNewActivities();

      expect(Notice).toHaveBeenCalledWith(
        "🛑 Garmin rejected the API key.",
        expect.any(Number),
      );
    });

    test("keeps the API key in secret storage", () => {
      expect(secrets["strava-sync-garmin-api-key"]).toBe("garmin-key");
      expect(plugin.getGarminApiKey()).toBe("garmin-key");
      expect(plugin.settings.authentication.garminApiKey).toBeUndefined();
    });

    test("keeps the API key in settings without secret storage", async () => {
      (requireApiVersion as jest.Mock).mockReturnValue(false);
      try {
        await plugin.setGarminApiKey("old-obsidian-key");

        expect(plugin.settings.authentication.garminApiKey).toBe(
          "old-obsidian-key",
        );
        expect(plugin.getGarminApiKey()).toBe("old-obsidian-key");
      } finally {
        (requireApiVersion as jest.Mock).mockReturnValue(true);
      }
    });
  });

  describe("loadSettings", () => {
    test("fills in settings added since they were saved", async () => {
      (plugin.loadData as jest.Mock).mockResolvedValueOnce({
        sync: { folder: "Runs" },
      });

      await plugin.loadSettings();

      expect(plugin.settings.sync.folder).toBe("Runs");
      expect(plugin.settings.sync.source).toBe("strava");
      expect(plugin.settings.sync.filename).toBe("{{id}} {{name}}");
    });

    test("moves the old default template to the new one", async () => {
      (plugin.loadData as jest.Mock).mockResolvedValueOnce({
        activity: { template: LEGACY_DEFAULT_TEMPLATE },
      });

      await plugin.loadSettings();

      expect(plugin.settings.activity.template).toBe(DEFAULT_TEMPLATE);
    });

    test("keeps a customised template", async () => {
      (plugin.loadData as jest.Mock).mockResolvedValueOnce({
        activity: { template: "# {{name}}" },
      });

      await plugin.loadSettings();

      expect(plugin.settings.activity.template).toBe("# {{name}}");
    });
  });
});
