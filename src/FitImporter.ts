import { unzipSync } from "fflate";
import FitParser, { type ParsedFit } from "fit-file-parser";
import type { Activity, Lap } from "./Activity";
import {
  type CalorieProfile,
  type CalorieSample,
  estimateCalories,
} from "./Calories";

export type FitSession = NonNullable<ParsedFit["sessions"]>[number];
export type FitActivity = ParsedFit["activity"];
export type FitLap = NonNullable<ParsedFit["laps"]>[number];
export type FitWorkoutStep = NonNullable<
  NonNullable<ParsedFit["messages"]>["workout_step"]
>[number];

export interface FitFile {
  name: string;
  data: ArrayBuffer;
}

export interface FitImportResult {
  activities: Activity[];
  errors: { file: string; message: string }[];
}

export class FitImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitImportError";
  }
}

// FIT sport (and sub sport) to the Strava sport type used by the rest of the
// plugin, so activity icons and templates work the same for both sources.
const SUB_SPORT_TYPES: Record<string, Record<string, string>> = {
  running: {
    trail: "TrailRun",
    virtual_activity: "VirtualRun",
  },
  cycling: {
    mountain: "MountainBikeRide",
    gravel_cycling: "GravelRide",
    e_bike_mountain: "EMountainBikeRide",
    virtual_activity: "VirtualRide",
    indoor_cycling: "VirtualRide",
  },
  alpine_skiing: {
    backcountry: "BackcountrySki",
  },
  training: {
    strength_training: "WeightTraining",
    yoga: "Yoga",
    pilates: "Pilates",
  },
  fitness_equipment: {
    elliptical: "Elliptical",
    stair_climbing: "StairStepper",
    indoor_rowing: "Rowing",
  },
};

const SPORT_TYPES: Record<string, string> = {
  running: "Run",
  cycling: "Ride",
  e_biking: "EBikeRide",
  swimming: "Swim",
  walking: "Walk",
  hiking: "Hike",
  rowing: "Rowing",
  alpine_skiing: "AlpineSki",
  cross_country_skiing: "NordicSki",
  snowboarding: "Snowboard",
  snowshoeing: "Snowshoe",
  hiit: "HighIntensityIntervalTraining",
  rock_climbing: "RockClimbing",
  stand_up_paddleboarding: "StandUpPaddling",
  kayaking: "Kayaking",
  surfing: "Surfing",
  golf: "Golf",
  tennis: "Tennis",
  soccer: "Soccer",
  inline_skating: "InlineSkate",
};

const sportType = (sport?: string, subSport?: string): string =>
  (sport && subSport && SUB_SPORT_TYPES[sport]?.[subSport]) ||
  (sport && SPORT_TYPES[sport]) ||
  "Workout";

// The device's offset from UTC when the activity was recorded, in seconds.
// The parser gives local time as a Date holding the local clock time.
export const utcOffsetSeconds = (
  activity?: FitActivity,
): number | undefined => {
  if (
    !(activity?.timestamp instanceof Date) ||
    !(activity.local_timestamp instanceof Date)
  ) {
    return undefined;
  }

  return (
    (activity.local_timestamp.getTime() - activity.timestamp.getTime()) / 1000
  );
};

// FIT files have no title, so name activities the way Strava does,
// e.g. "Morning Trail Run", using the time where the activity was recorded.
const activityName = (
  start: Date,
  type: string,
  offsetSeconds?: number,
): string => {
  const hour =
    offsetSeconds === undefined
      ? start.getHours()
      : new Date(start.getTime() + offsetSeconds * 1000).getUTCHours();
  const timeOfDay =
    hour < 5
      ? "Night"
      : hour < 12
        ? "Morning"
        : hour < 17
          ? "Afternoon"
          : hour < 21
            ? "Evening"
            : "Night";

  return `${timeOfDay} ${type.replace(/([a-z])([A-Z])/g, "$1 $2")}`;
};

export const sessionToActivity = (
  session: FitSession,
  offsetSeconds?: number,
): Activity => {
  const start = session.start_time;
  if (!(start instanceof Date)) {
    throw new FitImportError("Session has no start time");
  }

  // Unknown sports come through as numbers
  const type = sportType(
    typeof session.sport === "string" ? session.sport : undefined,
    typeof session.sub_sport === "string" ? session.sub_sport : undefined,
  );

  return {
    // FIT files have no activity ID, so the start time (in seconds) stands
    // in for one. Importing the same file again finds the same note.
    id: Math.floor(start.getTime() / 1000),
    start_date: start,
    name: activityName(start, type, offsetSeconds),
    sport_type: type,
    description: "",
    private_note: "",
    elapsed_time: session.total_elapsed_time ?? 0, // s
    moving_time: session.total_timer_time ?? 0, // s
    distance: session.total_distance ?? 0, // m
    max_heart_rate: session.max_heart_rate ?? 0, // bpm
    max_speed: session.enhanced_max_speed ?? session.max_speed ?? 0, // m/s
    average_speed: session.enhanced_avg_speed ?? session.avg_speed ?? 0, // m/s
    total_elevation_gain: session.total_ascent ?? 0, // m
    elev_low: session.enhanced_min_altitude ?? session.min_altitude ?? 0, // m
    elev_high: session.enhanced_max_altitude ?? session.max_altitude ?? 0, // m
    calories: session.total_calories ?? 0, // kcal
    source: "FIT",
  };
};

// The items (records or laps) recorded during a session, by their time.
// Without the session's times, a file's only session gets them all.
// Records at the very end belong to the session; a lap starting then
// belongs to the next one.
const duringSession = <T>(
  session: FitSession,
  items: T[],
  timeOf: (item: T) => unknown,
  onlySession: boolean,
  includeEnd: boolean,
): T[] => {
  const start = session.start_time;
  const elapsed = session.total_elapsed_time;
  if (!(start instanceof Date) || elapsed === undefined) {
    return onlySession ? items : [];
  }
  const from = start.getTime();
  const to = from + elapsed * 1000;

  return items.filter((item) => {
    const time = timeOf(item);
    return (
      time instanceof Date &&
      time.getTime() >= from &&
      (includeEnd ? time.getTime() <= to : time.getTime() < to)
    );
  });
};

const optional = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

// Message indexes come through as { value }, or as plain numbers.
const indexValue = (index: unknown): number | undefined =>
  typeof index === "number"
    ? index
    : optional((index as { value?: unknown } | undefined)?.value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

// A structured workout's steps, by their index. Each lap names the step it
// was recorded in.
const workoutSteps = (fit: ParsedFit): Map<number, FitWorkoutStep> =>
  new Map(
    (fit.messages?.workout_step ?? []).map((step, position) => [
      indexValue(step.message_index) ?? position,
      step,
    ]),
  );

export const lapToLap = (
  lap: FitLap,
  index: number,
  steps: Map<number, FitWorkoutStep> = new Map(),
): Lap => {
  const stepIndex = indexValue(lap.wkt_step_index);
  const step = stepIndex === undefined ? undefined : steps.get(stepIndex);
  // Unnamed steps often say what they are in their notes, e.g. "Stride"
  const notes = text(step?.notes);
  const intensity = [lap.intensity, step?.intensity].find(
    (value) => typeof value === "string",
  );

  return {
    number: index + 1,
    step: text(step?.wkt_step_name) ?? notes,
    step_notes: notes,
    intensity: intensity as string | undefined,
    elapsed_time: optional(lap.total_elapsed_time) ?? 0,
    moving_time: optional(lap.total_timer_time) ?? 0,
    distance: optional(lap.total_distance) ?? 0,
    average_speed:
      optional(lap.enhanced_avg_speed) ?? optional(lap.avg_speed) ?? 0,
    max_speed: optional(lap.enhanced_max_speed) ?? optional(lap.max_speed) ?? 0,
    average_heart_rate: optional(lap.avg_heart_rate),
    max_heart_rate: optional(lap.max_heart_rate),
    average_cadence: optional(lap.avg_cadence),
    average_power: optional(lap.avg_power),
    total_elevation_gain: optional(lap.total_ascent),
    calories: optional(lap.total_calories),
  };
};

const withLaps = (
  activity: Activity,
  laps: FitLap[],
  steps: Map<number, FitWorkoutStep>,
): Activity =>
  laps.length > 0
    ? {
        ...activity,
        laps: laps.map((lap, index) => lapToLap(lap, index, steps)),
      }
    : activity;

// Adds calories estimated from the session's heart rate or power, when
// there's a profile to estimate with and enough data.
const withEstimatedCalories = (
  activity: Activity,
  session: FitSession,
  records: CalorieSample[],
  profile?: CalorieProfile,
): Activity => {
  if (!profile) {
    return activity;
  }

  const estimate = estimateCalories(records, profile, {
    start: activity.start_date,
    timerSeconds: activity.moving_time,
    isCycling: session.sport === "cycling",
  });

  return estimate
    ? {
        ...activity,
        estimated_calories: estimate.kcal,
        active_calories: estimate.activeKcal,
        calories_method: estimate.method,
      }
    : activity;
};

// One activity per session: most files have one, multisport files
// (e.g. a triathlon) have one per leg. With a profile, calories are also
// estimated from each session's heart rate or power.
export const parseFitFile = async (
  data: ArrayBuffer,
  profile?: CalorieProfile,
): Promise<Activity[]> => {
  let fit: ParsedFit;
  try {
    // Checks the file's CRC, rather than guessing at damaged files.
    fit = await new FitParser({ force: false }).parseAsync(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FitImportError(
      /crc/i.test(message)
        ? `The file is damaged (${message})`
        : `Not a FIT file (${message})`,
    );
  }

  const sessions = fit.sessions ?? [];

  if (sessions.length === 0) {
    throw new FitImportError("No activity found (the file has no sessions)");
  }

  const offsetSeconds = utcOffsetSeconds(fit.activity);

  const records = fit.records ?? [];
  const laps = fit.laps ?? [];
  const steps = workoutSteps(fit);
  const workoutName = text(fit.workout?.wkt_name);
  const onlySession = sessions.length === 1;

  return sessions.map((session) =>
    withEstimatedCalories(
      withLaps(
        {
          ...sessionToActivity(session, offsetSeconds),
          ...(workoutName ? { workout_name: workoutName } : {}),
        },
        duringSession(
          session,
          laps,
          (lap) => lap.start_time,
          onlySession,
          false,
        ),
        steps,
      ),
      session,
      duringSession(
        session,
        records,
        (record) => record.timestamp,
        onlySession,
        true,
      ),
      profile,
    ),
  );
};

const isZip = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 && // P
  bytes[1] === 0x4b && // K
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

// The FIT files in a file: the file itself, or every .fit file in a zip
// (Garmin's activity downloads and bulk exports come zipped).
export const extractFitFiles = (file: FitFile): FitFile[] => {
  const bytes = new Uint8Array(file.data);

  if (!isZip(bytes)) {
    return [file];
  }

  const entries = Object.entries(
    unzipSync(bytes, {
      filter: (entry) => entry.name.toLowerCase().endsWith(".fit"),
    }),
  );

  if (entries.length === 0) {
    throw new FitImportError("The zip file has no .fit files");
  }

  return entries.map(([name, content]) => ({
    name: `${file.name}/${name}`,
    data: content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ),
  }));
};

export class FitImporter {
  files: FitFile[];
  profile?: CalorieProfile;

  constructor(files: FitFile[], profile?: CalorieProfile) {
    this.files = files;
    this.profile = profile;
  }

  // Files that can't be read are reported, and don't stop the others.
  async import(): Promise<FitImportResult> {
    const result: FitImportResult = { activities: [], errors: [] };

    const addError = (file: FitFile, error: unknown) =>
      result.errors.push({
        file: file.name,
        message: error instanceof Error ? error.message : String(error),
      });

    for (const file of this.files) {
      let fitFiles: FitFile[];
      try {
        fitFiles = extractFitFiles(file);
      } catch (error) {
        addError(file, error);
        continue;
      }

      for (const fitFile of fitFiles) {
        try {
          result.activities.push(
            ...(await parseFitFile(fitFile.data, this.profile)),
          );
        } catch (error) {
          addError(fitFile, error);
        }
      }
    }

    return result;
  }
}
