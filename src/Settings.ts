import { DEFAULT_TEMPLATE } from "./ActivityRenderer";
import type { CalorieProfile, Sex } from "./Calories";

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
  "estimated_calories",
  "active_calories",
  "calories_method",
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
  calories: {
    weightUnit: "kg",
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

export type WeightUnit = "kg" | "lb";

// Your details, for estimating calories from heart rate or power.
// Estimates are made only once sex, birth year and weight are all set.
export interface CalorieSettings {
  sex?: Sex;
  birthYear?: number;
  weight?: number;
  weightUnit: WeightUnit;
  // ml/kg/min, e.g. the VO2 max your watch shows
  vo2max?: number;
  // The calorie properties already added to the front matter, so each is
  // only added once
  addedProperties?: string[];
  // Before active_calories: true once the first three were added
  propertiesAdded?: boolean;
}

export interface Settings {
  authentication: AuthenticationSettings;
  sync: SyncSettings;
  activity: ActivitySettings;
  calories: CalorieSettings;
}

const KG_PER_LB = 0.45359237;

// The profile calorie estimates need, or undefined if it isn't complete.
export const calorieProfile = ({
  sex,
  birthYear,
  weight,
  weightUnit,
  vo2max,
}: CalorieSettings): CalorieProfile | undefined => {
  if (!sex || !birthYear || !weight || weight <= 0) {
    return undefined;
  }

  return {
    sex,
    birthYear,
    weightKg: weightUnit === "lb" ? weight * KG_PER_LB : weight,
    vo2max: vo2max && vo2max > 0 ? vo2max : undefined,
  };
};

export const CALORIE_PROPERTIES = [
  "calories",
  "estimated_calories",
  "active_calories",
  "calories_method",
];

// Once your calorie details are complete, adds the calorie properties to
// the front matter, so estimates show without more setup. Each only once:
// properties you remove afterwards stay removed. True if it changed them.
export const addCalorieProperties = (settings: Settings): boolean => {
  const { calories } = settings;
  if (!calorieProfile(calories)) {
    return false;
  }

  const added =
    calories.addedProperties ??
    (calories.propertiesAdded
      ? ["calories", "estimated_calories", "calories_method"]
      : []);
  const toAdd = CALORIE_PROPERTIES.filter(
    (property) => !added.includes(property),
  );
  if (toAdd.length === 0) {
    return false;
  }

  const properties = settings.activity.frontMatterProperties;
  settings.activity.frontMatterProperties = [
    ...properties,
    ...toAdd.filter((property) => !properties.includes(property)),
  ];
  calories.addedProperties = [...added, ...toAdd];
  calories.propertiesAdded = undefined;
  return true;
};
