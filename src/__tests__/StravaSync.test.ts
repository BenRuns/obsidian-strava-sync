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

  // The secrets in the mock App's secret storage
  const secrets = () =>
    (app as unknown as { secretStorage: { secrets: Record<string, string> } })
      .secretStorage.secrets;

  describe("with Garmin as the source", () => {
    const garminActivity = (startTime: string) => ({
      id: Date.parse(startTime) / 1000,
      name: "Run",
      start_date: new Date(startTime),
      source: "Garmin",
    });

    beforeEach(async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      mockGarminImport.mockReset();
      await plugin.loadSettings();
      plugin.settings.sync.source = "garmin";
      secrets()["my-garmin-key"] = "garmin-key";
      await plugin.setGarminApiKeyName("my-garmin-key");
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
      await plugin.setGarminApiKeyName(null);

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

    test("reads the API key from the chosen secret", () => {
      expect(plugin.getGarminApiKey()).toBe("garmin-key");

      // Changed in Obsidian's secret storage: used straight away
      secrets()["my-garmin-key"] = "new-key";
      expect(plugin.getGarminApiKey()).toBe("new-key");
    });

    test("saves only the secret's name", () => {
      const saved = (plugin.saveData as jest.Mock).mock.lastCall[0];

      expect(saved.authentication.garminApiKeyName).toBe("my-garmin-key");
      expect(JSON.stringify(saved)).not.toContain('"garmin-key"');
    });
  });

  describe("secrets", () => {
    const SECRETS_IN_DATA_JSON = {
      stravaClientId: "client-id",
      stravaClientSecret: "client-secret",
      stravaAccessToken: "access-token",
      stravaRefreshToken: "refresh-token",
      stravaTokenExpiresAt: 1234,
      garminApiKey: "garmin-key",
    };

    const savedAuthentication = () =>
      (plugin.saveData as jest.Mock).mock.lastCall[0].authentication;

    beforeEach(() => {
      (plugin.saveData as jest.Mock).mockClear();
    });

    test("moves secrets saved in data.json into secret storage", async () => {
      (plugin.loadData as jest.Mock).mockResolvedValueOnce({
        authentication: SECRETS_IN_DATA_JSON,
      });

      await plugin.loadSettings();

      expect(secrets()).toEqual({
        "strava-sync-client-secret": "client-secret",
        "strava-sync-access-token": "access-token",
        "strava-sync-refresh-token": "refresh-token",
        "strava-sync-garmin-api-key": "garmin-key",
      });

      // data.json is saved again without them
      expect(JSON.parse(JSON.stringify(savedAuthentication()))).toEqual({
        stravaClientId: "client-id",
        stravaClientSecret: "",
        stravaClientSecretName: "strava-sync-client-secret",
        stravaTokenExpiresAt: 1234,
        garminApiKeyName: "strava-sync-garmin-api-key",
      });

      // and the plugin carries on with them
      expect(plugin.settings.authentication).toMatchObject({
        stravaClientSecret: "client-secret",
        stravaAccessToken: "access-token",
        stravaRefreshToken: "refresh-token",
      });
      expect(plugin.getGarminApiKey()).toBe("garmin-key");
    });

    test("loads secrets from secret storage", async () => {
      Object.assign(secrets(), {
        "my-strava-secret": "client-secret",
        "strava-sync-access-token": "access-token",
        "strava-sync-refresh-token": "refresh-token",
      });
      (plugin.loadData as jest.Mock).mockResolvedValueOnce({
        authentication: {
          stravaClientId: "client-id",
          stravaClientSecret: "",
          stravaClientSecretName: "my-strava-secret",
          stravaTokenExpiresAt: 1234,
        },
      });

      await plugin.loadSettings();

      expect(plugin.settings.authentication).toMatchObject({
        stravaClientSecret: "client-secret",
        stravaAccessToken: "access-token",
        stravaRefreshToken: "refresh-token",
      });
      expect(plugin.saveData).not.toHaveBeenCalled();
    });

    test("keeps new Strava tokens out of data.json", async () => {
      await plugin.loadSettings();
      Object.assign(plugin.settings.authentication, {
        stravaAccessToken: "new-access-token",
        stravaRefreshToken: "new-refresh-token",
        stravaTokenExpiresAt: 5678,
      });

      await plugin.saveSettings();

      expect(secrets()["strava-sync-access-token"]).toBe("new-access-token");
      expect(secrets()["strava-sync-refresh-token"]).toBe("new-refresh-token");
      expect(savedAuthentication().stravaAccessToken).toBeUndefined();
      expect(savedAuthentication().stravaRefreshToken).toBeUndefined();
      expect(savedAuthentication().stravaTokenExpiresAt).toBe(5678);
      // Still there for the plugin to use
      expect(plugin.settings.authentication.stravaAccessToken).toBe(
        "new-access-token",
      );
    });

    test("blanks tokens that are gone", async () => {
      secrets()["strava-sync-access-token"] = "old-token";
      await plugin.loadSettings();
      plugin.settings.authentication.stravaAccessToken = undefined;

      await plugin.saveSettings();

      expect(secrets()["strava-sync-access-token"]).toBe("");
      expect(secrets()).not.toHaveProperty("strava-sync-refresh-token");
    });

    test("uses the chosen Strava client secret", async () => {
      await plugin.loadSettings();
      secrets()["my-strava-secret"] = "client-secret";

      await plugin.setStravaClientSecretName("my-strava-secret");

      expect(plugin.settings.authentication.stravaClientSecret).toBe(
        "client-secret",
      );
      expect(savedAuthentication()).toMatchObject({
        stravaClientSecret: "",
        stravaClientSecretName: "my-strava-secret",
      });
    });

    test("reads a changed client secret before importing from Strava", async () => {
      await plugin.loadSettings();
      secrets()["my-strava-secret"] = "old-secret";
      await plugin.setStravaClientSecretName("my-strava-secret");
      secrets()["my-strava-secret"] = "new-secret";

      await plugin.importNewActivities();

      expect(plugin.settings.authentication.stravaClientSecret).toBe(
        "new-secret",
      );
    });

    describe("without secret storage (before Obsidian 1.11.4)", () => {
      beforeEach(() => {
        (requireApiVersion as jest.Mock).mockReturnValue(false);
      });

      afterEach(() => {
        (requireApiVersion as jest.Mock).mockReturnValue(true);
      });

      test("keeps secrets in data.json", async () => {
        (plugin.loadData as jest.Mock).mockResolvedValueOnce({
          authentication: SECRETS_IN_DATA_JSON,
        });

        await plugin.loadSettings();
        await plugin.saveSettings();

        expect(secrets()).toEqual({});
        expect(savedAuthentication()).toMatchObject(SECRETS_IN_DATA_JSON);
        expect(plugin.getGarminApiKey()).toBe("garmin-key");
      });

      test("saves a Garmin API key", async () => {
        await plugin.loadSettings();

        await plugin.setGarminApiKey(" garmin-key ");

        expect(savedAuthentication().garminApiKey).toBe("garmin-key");
        expect(plugin.getGarminApiKey()).toBe("garmin-key");
      });
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
