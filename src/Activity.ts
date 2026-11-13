// A lap, or an interval of a structured workout. Times are in seconds,
// distances in metres and speeds in metres per second.
export interface Lap {
  // From 1
  number: number;
  // The lap's name, if it has one (Strava: "Lap 1")
  name?: string;
  // What the lap was for (FIT and Garmin only): "active", "rest", "warmup",
  // "cooldown", "recovery", "interval" or "other"
  intensity?: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_speed: number;
  max_speed: number;
  average_heart_rate?: number; // bpm
  max_heart_rate?: number; // bpm
  average_cadence?: number; // rpm, or steps a minute on one foot
  average_power?: number; // W
  total_elevation_gain?: number; // m
  calories?: number; // kcal
}

export interface Activity {
  id: number;
  start_date: Date;
  name: string;
  sport_type: string;
  description: string;
  private_note: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  max_heart_rate: number;
  max_speed: number;
  average_speed: number;
  total_elevation_gain: number;
  elev_low: number;
  elev_high: number;
  calories: number;
  // Calories estimated from heart rate or power and your profile (FIT and
  // Garmin imports only); the part of them above resting burn; and how they
  // were estimated: "heart_rate" or "power"
  estimated_calories?: number;
  active_calories?: number;
  calories_method?: string;
  // Link to the activity online, if it has one
  url?: string;
  // Laps or workout intervals, in order, if the activity has any
  laps?: Lap[];
  // Where it was imported from: "Strava", "Garmin" or "FIT"
  source?: string;

  [propName: string]: unknown;
}
