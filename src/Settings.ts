import { DEFAULT_TEMPLATE } from "./ActivityRenderer";

export const VALID_FRONT_MATTER_PROPERTIES = [
  "id",
  "start_date",
  "name",
  "sport_type",
  "description",
  "private_note",
  "elapsed_time",
  "moving_time",
  "distance",
  "max_heart_rate",
  "max_speed",
  "average_speed",
  "total_elevation_gain",
  "elev_low",
  "elev_high",
  "calories",
  "icon",
  "url",
  "source",
];

export const DEFAULT_SETTINGS: Settings = {
  authentication: {
    stravaClientId: "",
    stravaClientSecret: "",
    stravaAccessToken: undefined,
    stravaRefreshToken: undefined,
    stravaTokenExpiresAt: undefined,
  },
  sync: {
    source: "strava",
    folder: "physical-activities/{{start_date}}",
    folderDateFormat: "yyyy-MM-dd",
    filename: "{{id}} {{name}}",
    filenameDateFormat: "yyyy-MM-dd",
  },
  activity: {
    contentDateFormat: "yyyy-MM-dd HH:mm:ss",
    frontMatterProperties: [
      "name",
      "start_date",
      "sport_type",
      "description",
      "private_note",
      "elapsed_time",
      "moving_time",
      "distance",
      "icon",
    ],
    template: DEFAULT_TEMPLATE,
  },
};

// On Obsidian 1.11.4+, secrets live in Obsidian's secret storage, not
// data.json: the client secret and Garmin key you pick by name (saved here),
// and Strava's sign-in tokens under the plugin's own names. While the plugin
// runs, the values are also held here; saveSettings leaves them out.
export interface AuthenticationSettings {
  stravaClientId: string;
  stravaClientSecret: string;
  // Name of the secret holding the Strava client secret
  stravaClientSecretName?: string;
  stravaAccessToken?: string;
  stravaRefreshToken?: string;
  stravaTokenExpiresAt?: number;
  // Only saved on Obsidian versions without secret storage (before 1.11.4)
  garminApiKey?: string;
  // Name of the secret holding the Garmin API key
  garminApiKeyName?: string;
}

// Where "Import new activities" gets activities from.
export type ActivitySource = "strava" | "garmin";

interface SyncSettings {
  source: ActivitySource;
  folder: string;
  folderDateFormat: string;
  filename: string;
  filenameDateFormat: string;
  // Start time (in seconds) of the newest activity imported from Strava
  lastActivityTimestamp?: number;
  // The same for Garmin
  lastGarminActivityTimestamp?: number;
}

interface ActivitySettings {
  contentDateFormat: string;
  frontMatterProperties: string[];
  template: string;
}

export interface Settings {
  authentication: AuthenticationSettings;
  sync: SyncSettings;
  activity: ActivitySettings;
}
