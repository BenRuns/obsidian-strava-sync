import {
  type ActivityMesg,
  Decoder,
  type SessionMesg,
  Stream,
} from "@garmin/fitsdk";
import type { Activity } from "./Activity";

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
    virtualActivity: "VirtualRun",
  },
  cycling: {
    mountain: "MountainBikeRide",
    gravelCycling: "GravelRide",
    eBikeMountain: "EMountainBikeRide",
    virtualActivity: "VirtualRide",
    indoorCycling: "VirtualRide",
  },
  alpineSkiing: {
    backcountry: "BackcountrySki",
  },
  training: {
    strengthTraining: "WeightTraining",
    yoga: "Yoga",
    pilates: "Pilates",
  },
  fitnessEquipment: {
    elliptical: "Elliptical",
    stairClimbing: "StairStepper",
    indoorRowing: "Rowing",
  },
};

const SPORT_TYPES: Record<string, string> = {
  running: "Run",
  cycling: "Ride",
  eBiking: "EBikeRide",
  swimming: "Swim",
  walking: "Walk",
  hiking: "Hike",
  rowing: "Rowing",
  alpineSkiing: "AlpineSki",
  crossCountrySkiing: "NordicSki",
  snowboarding: "Snowboard",
  snowshoeing: "Snowshoe",
  hiit: "HighIntensityIntervalTraining",
  rockClimbing: "RockClimbing",
  standUpPaddleboarding: "StandUpPaddling",
  kayaking: "Kayaking",
  surfing: "Surfing",
  golf: "Golf",
  tennis: "Tennis",
  soccer: "Soccer",
  inlineSkating: "InlineSkate",
};

const sportType = (sport?: string, subSport?: string): string =>
  (sport && subSport && SUB_SPORT_TYPES[sport]?.[subSport]) ||
  (sport && SPORT_TYPES[sport]) ||
  "Workout";

// FIT local times count seconds from 1989-12-31 00:00, not 1970.
const FIT_EPOCH_SECONDS = 631065600;

// The device's offset from UTC when the activity was recorded, in seconds.
export const utcOffsetSeconds = (
  activity?: ActivityMesg,
): number | undefined => {
  if (
    !(activity?.timestamp instanceof Date) ||
    typeof activity.localTimestamp !== "number"
  ) {
    return undefined;
  }

  return (
    activity.localTimestamp +
    FIT_EPOCH_SECONDS -
    activity.timestamp.getTime() / 1000
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
  session: SessionMesg,
  offsetSeconds?: number,
): Activity => {
  if (!(session.startTime instanceof Date)) {
    throw new FitImportError("Session has no start time");
  }

  const type = sportType(
    session.sport as string | undefined,
    session.subSport as string | undefined,
  );

  return {
    // FIT files have no activity ID, so the start time (in seconds) stands
    // in for one. Importing the same file again finds the same note.
    id: Math.floor(session.startTime.getTime() / 1000),
    start_date: session.startTime,
    name: activityName(session.startTime, type, offsetSeconds),
    sport_type: type,
    description: "",
    private_note: "",
    elapsed_time: session.totalElapsedTime ?? 0, // s
    moving_time: session.totalTimerTime ?? 0, // s
    distance: session.totalDistance ?? 0, // m
    max_heart_rate: session.maxHeartRate ?? 0, // bpm
    max_speed: session.enhancedMaxSpeed ?? session.maxSpeed ?? 0, // m/s
    average_speed: session.enhancedAvgSpeed ?? session.avgSpeed ?? 0, // m/s
    total_elevation_gain: session.totalAscent ?? 0, // m
    elev_low: session.enhancedMinAltitude ?? 0, // m
    elev_high: session.enhancedMaxAltitude ?? 0, // m
    calories: session.totalCalories ?? 0, // kcal
  };
};

// One activity per session: most files have one, multisport files
// (e.g. a triathlon) have one per leg.
export const parseFitFile = (data: ArrayBuffer): Activity[] => {
  const stream = Stream.fromArrayBuffer(data);

  if (!Decoder.isFIT(stream)) {
    throw new FitImportError("Not a FIT file");
  }

  const decoder = new Decoder(stream);

  if (!decoder.checkIntegrity()) {
    throw new FitImportError("The file is damaged (integrity check failed)");
  }

  const { messages, errors } = decoder.read();

  if (errors.length > 0) {
    throw new FitImportError(errors[0].message);
  }

  const sessions = messages.sessionMesgs ?? [];

  if (sessions.length === 0) {
    throw new FitImportError("No activity found (the file has no sessions)");
  }

  const offsetSeconds = utcOffsetSeconds(messages.activityMesgs?.[0]);

  return sessions.map((session) => sessionToActivity(session, offsetSeconds));
};

export class FitImporter {
  files: FitFile[];

  constructor(files: FitFile[]) {
    this.files = files;
  }

  // Files that can't be read are reported, and don't stop the others.
  import(): FitImportResult {
    const result: FitImportResult = { activities: [], errors: [] };

    for (const file of this.files) {
      try {
        result.activities.push(...parseFitFile(file.data));
      } catch (error) {
        result.errors.push({
          file: file.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }
}
