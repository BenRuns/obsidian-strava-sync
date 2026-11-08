import { Notice, Plugin, addIcon, requireApiVersion } from "obsidian";
import { ActivitiesCSVImporter, CSVImportError } from "./ActivitiesCSVImporter";
import type { Activity } from "./Activity";
import { ActivityImporter } from "./ActivityImporter";
import { LEGACY_DEFAULT_TEMPLATE } from "./ActivityRenderer";
import { ActivitySerializer } from "./ActivitySerializer";
import { FileSelector } from "./FileSelector";
import { FitImporter } from "./FitImporter";
import { GarminActivityImporter } from "./GarminActivityImporter";
import { GarminApi, GarminApiError } from "./GarminApi";
import { DEFAULT_SETTINGS, type Settings } from "./Settings";
import { SettingsTab } from "./SettingsTab";
import { StravaApi } from "./StravaApi";

const ICON_ID = "strava";
const SUCCESS_NOTICE_DURATION = 4000;
const ERROR_NOTICE_DURATION = 8000;
// Obsidian's secret storage (1.11.4+): Strava's sign-in tokens are kept under
// these names, and secrets moved out of data.json get the others.
const STRAVA_ACCESS_TOKEN_SECRET = "strava-sync-access-token";
const STRAVA_REFRESH_TOKEN_SECRET = "strava-sync-refresh-token";
const STRAVA_CLIENT_SECRET_SECRET = "strava-sync-client-secret";
const GARMIN_API_KEY_SECRET = "strava-sync-garmin-api-key";

export default class StravaSync extends Plugin {
  settings: Settings;
  settingsTab: SettingsTab;
  stravaApi: StravaApi;
  garminApi: GarminApi;
  activities: Activity[] = [];
  fileSelector: FileSelector;
  fitFileSelector: FileSelector;
  activitySerializer: ActivitySerializer;

  async onload() {
    await this.loadSettings();

    this.settingsTab = new SettingsTab(this.app, this);
    this.stravaApi = new StravaApi(this.settings.authentication);
    this.garminApi = new GarminApi(() => this.getGarminApiKey());
    this.fileSelector = new FileSelector(".csv");
    this.fitFileSelector = new FileSelector(".fit,.zip");
    this.activitySerializer = new ActivitySerializer(this.app, this.settings);

    addIcon(
      ICON_ID,
      `<svg fill="currentColor" viewBox="0 0 24 24" role="img" xmlns="http://www.w3.org/2000/svg"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>`,
    );

    this.addRibbonIcon(ICON_ID, "Import new activities", () => {
      void this.importNewActivities();
    });

    this.registerObsidianProtocolHandler("strava-sync", async (args) => {
      this.loadStravaClientSecret();
      await this.stravaApi.exchangeCodeForToken(args.code);
      this.settings.authentication = this.stravaApi.settings;
      await this.saveSettings();

      new Notice(
        "✅ Successfully authenticated with Strava!",
        SUCCESS_NOTICE_DURATION,
      );

      // Refresh the settings tab to update the authentication status
      this.settingsTab.refresh();
    });

    this.addCommand({
      id: "import-new",
      name: "Import new activities",
      callback: () => {
        void this.importNewActivities();
      },
    });

    this.addCommand({
      id: "import-csv",
      name: "Import Strava activities from bulk export CSV",
      callback: () => {
        void this.importActivitiesFromCSV();
      },
    });

    this.addCommand({
      id: "import-fit",
      name: "Import activities from FIT files",
      callback: () => {
        void this.importActivitiesFromFIT();
      },
    });

    this.addSettingTab(this.settingsTab);
  }

  onunload() {}

  async importActivitiesFromCSV() {
    try {
      const fileContents = await this.fileSelector.selectContents();
      this.activities = await new ActivitiesCSVImporter(fileContents).import();

      await this.serializeActivities(false);
    } catch (error) {
      if (error instanceof CSVImportError) {
        new Notice(
          `🛑 CSV Import Error:\n\n${error.message}`,
          ERROR_NOTICE_DURATION,
        );
      } else {
        console.error("Unexpected error during CSV import:", error);
        new Notice(
          "🛑 An unexpected error occurred during import. Check the console for details.",
          ERROR_NOTICE_DURATION,
        );
      }
    }
  }

  async importActivitiesFromFIT() {
    try {
      const files = await this.fitFileSelector.selectFiles();
      const { activities, errors } = await new FitImporter(files).import();
      this.activities = activities;

      if (activities.length > 0) {
        await this.serializeActivities(false);
      }

      if (errors.length > 0) {
        console.error("FIT files that could not be imported:", errors);
        new Notice(
          `🛑 ${errors.length} of ${files.length} FIT files could not be imported:\n\n${errors
            .map(({ file, message }) => `${file}: ${message}`)
            .join("\n")}`,
          ERROR_NOTICE_DURATION,
        );
      }
    } catch (error) {
      console.error("Unexpected error during FIT import:", error);
      new Notice(
        "🛑 An unexpected error occurred during import. Check the console for details.",
        ERROR_NOTICE_DURATION,
      );
    }
  }

  // From the source chosen in settings: Strava or Garmin, never both.
  async importNewActivities() {
    if (this.settings.sync.source === "garmin") {
      await this.importNewGarminActivities();
    } else {
      await this.importNewStravaActivities();
    }
  }

  private async importNewGarminActivities() {
    if (!this.garminApi.isAuthenticated()) {
      new Notice(
        "🛑 Please add your Garmin API key in the plugin settings.",
        ERROR_NOTICE_DURATION,
      );
      return;
    }

    try {
      new Notice(
        "🔄 Importing new activities from Garmin...",
        SUCCESS_NOTICE_DURATION,
      );

      const { activities, errors } = await new GarminActivityImporter(
        this.garminApi,
        this.settings.sync.lastGarminActivityTimestamp,
      ).importLatestActivities();
      this.activities = activities;

      await this.serializeActivities(true);

      // Only move on once every activity has imported, so failed ones are
      // tried again next time.
      if (errors.length > 0) {
        console.error("Garmin activities that could not be imported:", errors);
        new Notice(
          `🛑 ${errors.length} Garmin activities could not be imported and will be tried again next time. Check the console for details.`,
          ERROR_NOTICE_DURATION,
        );
      } else if (activities.length > 0) {
        this.settings.sync.lastGarminActivityTimestamp = Math.max(
          ...activities.map((activity) => activity.start_date.getTime() / 1000),
        );
      }

      await this.saveSettings();
    } catch (error) {
      console.error("Unexpected error during Garmin import:", error);
      new Notice(
        error instanceof GarminApiError
          ? `🛑 ${error.message}`
          : "🛑 An unexpected error occurred during import. Check the console for details.",
        ERROR_NOTICE_DURATION,
      );
    }
  }

  private async importNewStravaActivities() {
    this.loadStravaClientSecret();

    try {
      if (!this.stravaApi.isAuthenticated()) {
        new Notice(
          "🛑 Please authenticate with Strava first in the plugin settings.",
          ERROR_NOTICE_DURATION,
        );
        return;
      }

      new Notice(
        "🔄 Importing new activities from Strava...",
        SUCCESS_NOTICE_DURATION,
      );

      this.activities = await new ActivityImporter(
        this.stravaApi,
        this.settings.sync.lastActivityTimestamp,
      ).importLatestActivities();

      await this.serializeActivities(true);

      if (this.activities.length > 0) {
        this.settings.sync.lastActivityTimestamp = Math.max(
          ...this.activities.map(
            (activity) => activity.start_date.getTime() / 1000,
          ),
        );
      }

      await this.saveSettings();
    } catch (error) {
      console.error("Unexpected error during Strava import:", error);
      new Notice(
        "🛑 An unexpected error occurred during import. Check the console for details.",
        ERROR_NOTICE_DURATION,
      );
    }
  }

  async loadSettings() {
    const saved = ((await this.loadData()) as Partial<Settings> | null) ?? {};

    // Merged section by section, so settings added since the last save
    // get their defaults.
    this.settings = {
      authentication: {
        ...DEFAULT_SETTINGS.authentication,
        ...saved.authentication,
      },
      sync: { ...DEFAULT_SETTINGS.sync, ...saved.sync },
      activity: { ...DEFAULT_SETTINGS.activity, ...saved.activity },
    };

    if (this.settings.activity.template === LEGACY_DEFAULT_TEMPLATE) {
      this.settings.activity.template = DEFAULT_SETTINGS.activity.template;
    }

    if (requireApiVersion("1.11.4")) {
      const secrets = this.app.secretStorage;
      const auth = this.settings.authentication;
      const inDataJson = Boolean(
        auth.stravaClientSecret ||
          auth.stravaAccessToken ||
          auth.stravaRefreshToken ||
          auth.garminApiKey,
      );

      // Secrets saved in data.json by earlier versions move to secret storage
      if (auth.stravaClientSecret && !auth.stravaClientSecretName) {
        secrets.setSecret(STRAVA_CLIENT_SECRET_SECRET, auth.stravaClientSecret);
        auth.stravaClientSecretName = STRAVA_CLIENT_SECRET_SECRET;
      }
      if (auth.garminApiKey && !auth.garminApiKeyName) {
        secrets.setSecret(GARMIN_API_KEY_SECRET, auth.garminApiKey);
      }
      if (!auth.garminApiKeyName && secrets.getSecret(GARMIN_API_KEY_SECRET)) {
        auth.garminApiKeyName = GARMIN_API_KEY_SECRET;
      }
      auth.garminApiKey = undefined;

      auth.stravaAccessToken =
        auth.stravaAccessToken ||
        secrets.getSecret(STRAVA_ACCESS_TOKEN_SECRET) ||
        undefined;
      auth.stravaRefreshToken =
        auth.stravaRefreshToken ||
        secrets.getSecret(STRAVA_REFRESH_TOKEN_SECRET) ||
        undefined;
      this.loadStravaClientSecret();

      if (inDataJson) {
        await this.saveSettings();
      }
    }
  }

  // Reads the chosen client secret from secret storage, where it may have
  // changed since the plugin loaded.
  loadStravaClientSecret() {
    const auth = this.settings.authentication;
    if (requireApiVersion("1.11.4")) {
      auth.stravaClientSecret =
        (auth.stravaClientSecretName &&
          this.app.secretStorage.getSecret(auth.stravaClientSecretName)) ||
        "";
    }
  }

  async setStravaClientSecretName(name: string | null) {
    this.settings.authentication.stravaClientSecretName = name || undefined;
    this.loadStravaClientSecret();
    await this.saveSettings();
  }

  getGarminApiKey(): string | null {
    const auth = this.settings.authentication;
    if (requireApiVersion("1.11.4")) {
      return auth.garminApiKeyName
        ? this.app.secretStorage.getSecret(auth.garminApiKeyName)
        : null;
    }
    return auth.garminApiKey ?? null;
  }

  async setGarminApiKeyName(name: string | null) {
    this.settings.authentication.garminApiKeyName = name || undefined;
    await this.saveSettings();
  }

  // Before Obsidian 1.11.4, which has no secret storage
  async setGarminApiKey(apiKey: string) {
    this.settings.authentication.garminApiKey = apiKey.trim() || undefined;
    await this.saveSettings();
  }

  // With secret storage, the secrets go there and are left out of data.json.
  async saveSettings() {
    if (requireApiVersion("1.11.4")) {
      const auth = this.settings.authentication;
      const tokens: [string, string | undefined][] = [
        [STRAVA_ACCESS_TOKEN_SECRET, auth.stravaAccessToken],
        [STRAVA_REFRESH_TOKEN_SECRET, auth.stravaRefreshToken],
      ];
      for (const [name, value] of tokens) {
        // Secrets can't be deleted, so a token that's gone is blanked
        if (value || this.app.secretStorage.getSecret(name)) {
          this.app.secretStorage.setSecret(name, value ?? "");
        }
      }

      await this.saveData({
        ...this.settings,
        authentication: {
          ...auth,
          stravaClientSecret: "",
          stravaAccessToken: undefined,
          stravaRefreshToken: undefined,
          garminApiKey: undefined,
        },
      });
    } else {
      await this.saveData(this.settings);
    }
  }

  private async serializeActivities(newLabel: boolean) {
    let createdCount = 0;
    let updatedCount = 0;

    await Promise.all(
      this.activities.map(async (activity) => {
        if (await this.activitySerializer.serialize(activity)) {
          createdCount++;
        } else {
          updatedCount++;
        }
      }),
    );

    let message = `🏃 ${createdCount} ${newLabel ? "new " : ""}activities created`;

    if (updatedCount > 0) {
      message += `, ${updatedCount} already existing`;
    }

    new Notice(`${message}.`, SUCCESS_NOTICE_DURATION);
  }
}
