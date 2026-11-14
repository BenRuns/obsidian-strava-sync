// FIT activity files built in memory for tests.
import {
  FitEncoder,
  type FitEncoderField,
  FitBaseType as T,
  getFitSportId,
  getFitSubSportId,
} from "fit-file-parser";

export const START = new Date("2026-10-25T07:30:00Z");

export interface TestSession {
  startTime: Date;
  sport?: string;
  subSport?: string;
  totalElapsedTime?: number; // s
  totalTimerTime?: number; // s
  totalDistance?: number; // m
  maxHeartRate?: number; // bpm
  enhancedAvgSpeed?: number; // m/s
  enhancedMaxSpeed?: number; // m/s
  totalAscent?: number; // m
  totalCalories?: number; // kcal
  enhancedMinAltitude?: number; // m
  enhancedMaxAltitude?: number; // m
}

export interface TestLap {
  startTime: Date;
  totalElapsedTime?: number; // s
  totalTimerTime?: number; // s
  totalDistance?: number; // m
  avgSpeed?: number; // m/s
  avgHeartRate?: number; // bpm
  avgPower?: number; // W
  intensity?: number; // 0 active, 1 rest, 2 warmup, 3 cooldown
  workoutStepIndex?: number;
}

export interface TestWorkout {
  name: string;
  steps: {
    name?: string;
    notes?: string;
    intensity?: number; // 0 active, 1 rest, 2 warmup, 3 cooldown, 4 recovery
  }[];
}

export interface TestRecord {
  timestamp: Date;
  heartRate?: number; // bpm
  power?: number; // W
}

// FIT message and field numbers, sizes, types and scales from the FIT profile.
const FILE_ID = 0;
const SESSION = 18;
const LAP = 19;
const WORKOUT = 26;
const WORKOUT_STEP = 27;
const RECORD = 20;
const ACTIVITY = 34;

const u8 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 1,
  baseType: T.Uint8,
  value,
});
const u16 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 2,
  baseType: T.Uint16,
  value,
});
const u32 = (number: number, value: number): FitEncoderField => ({
  number,
  size: 4,
  baseType: T.Uint32,
  value: Math.round(value),
});
const enumField = (number: number, value: number): FitEncoderField => ({
  number,
  size: 1,
  baseType: T.Enum,
  value,
});
const time = (number: number, date: Date) =>
  u32(number, FitEncoder.toFitTimestamp(date));
const altitude = (metres: number) => (metres + 500) * 5;

const sessionFields = (session: TestSession): FitEncoderField[] => {
  const fields = [time(2, session.startTime), time(253, session.startTime)];
  const add = (
    value: number | null | undefined,
    field: (v: number) => FitEncoderField,
  ) => {
    if (value !== undefined && value !== null) fields.push(field(value));
  };

  add(session.sport ? getFitSportId(session.sport) : undefined, (v) =>
    enumField(5, v),
  );
  add(session.subSport ? getFitSubSportId(session.subSport) : undefined, (v) =>
    enumField(6, v),
  );
  add(session.totalElapsedTime, (v) => u32(7, v * 1000));
  add(session.totalTimerTime, (v) => u32(8, v * 1000));
  add(session.totalDistance, (v) => u32(9, v * 100));
  add(session.totalCalories, (v) => u16(11, v));
  add(session.maxHeartRate, (v) => u8(17, v));
  add(session.totalAscent, (v) => u16(22, v));
  add(session.enhancedAvgSpeed, (v) => u32(124, v * 1000));
  add(session.enhancedMaxSpeed, (v) => u32(125, v * 1000));
  add(session.enhancedMinAltitude, (v) => u32(127, altitude(v)));
  add(session.enhancedMaxAltitude, (v) => u32(128, altitude(v)));
  return fields;
};

const lapFields = (lap: TestLap): FitEncoderField[] => {
  const fields = [time(2, lap.startTime), time(253, lap.startTime)];
  const add = (
    value: number | undefined,
    field: (v: number) => FitEncoderField,
  ) => {
    if (value !== undefined) fields.push(field(value));
  };

  add(lap.totalElapsedTime, (v) => u32(7, v * 1000));
  add(lap.totalTimerTime, (v) => u32(8, v * 1000));
  add(lap.totalDistance, (v) => u32(9, v * 100));
  add(lap.avgSpeed, (v) => u16(13, Math.round(v * 1000)));
  add(lap.avgHeartRate, (v) => u8(15, v));
  add(lap.avgPower, (v) => u16(19, v));
  add(lap.intensity, (v) => enumField(23, v));
  add(lap.workoutStepIndex, (v) => u16(71, v));
  return fields;
};

// A fixed-size string field, with bytes left after the text the way
// Garmin watches leave them.
const stringField = (number: number, text: string): FitEncoderField => {
  const value = new Uint8Array(32);
  const encoded = FitEncoder.string(text);
  value.set(encoded);
  value.set(
    new TextEncoder().encode("leftover").slice(0, 32 - encoded.length),
    encoded.length,
  );
  return { number, size: value.length, baseType: T.String, value };
};

// Builds a FIT activity file in memory, one session per entry. With a UTC
// offset, it also records the device's local time, as watches do.
export const buildFitFile = (
  sessions: TestSession[],
  options: {
    utcOffsetSeconds?: number;
    records?: TestRecord[];
    laps?: TestLap[];
    workout?: TestWorkout;
  } = {},
): ArrayBuffer => {
  const encoder = new FitEncoder().writeMessage(FILE_ID, [
    enumField(0, 4), // activity
    u16(1, 1), // Garmin
    time(4, START),
  ]);

  for (const record of options.records ?? []) {
    const fields = [time(253, record.timestamp)];
    if (record.heartRate !== undefined) fields.push(u8(3, record.heartRate));
    if (record.power !== undefined) fields.push(u16(7, record.power));
    encoder.writeMessage(RECORD, fields);
  }

  if (options.workout) {
    encoder.writeMessage(WORKOUT, [stringField(8, options.workout.name)]);
    options.workout.steps.forEach((step, index) => {
      const fields = [u16(254, index)];
      if (step.name !== undefined) fields.push(stringField(0, step.name));
      if (step.intensity !== undefined)
        fields.push(enumField(7, step.intensity));
      if (step.notes !== undefined) fields.push(stringField(8, step.notes));
      encoder.writeMessage(WORKOUT_STEP, fields);
    });
  }

  for (const lap of options.laps ?? []) {
    encoder.writeMessage(LAP, lapFields(lap));
  }

  for (const session of sessions) {
    encoder.writeMessage(SESSION, sessionFields(session));
  }

  if (options.utcOffsetSeconds !== undefined) {
    encoder.writeMessage(ACTIVITY, [
      time(253, START),
      u32(5, FitEncoder.toFitTimestamp(START) + options.utcOffsetSeconds),
    ]);
  }

  const bytes = encoder.close();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
};

export const RUN: TestSession = {
  startTime: START,
  sport: "running",
  subSport: "trail",
  totalElapsedTime: 3700,
  totalTimerTime: 3600,
  totalDistance: 10000,
  maxHeartRate: 175,
  enhancedAvgSpeed: 2.78,
  enhancedMaxSpeed: 4.1,
  totalAscent: 120,
  totalCalories: 700,
  enhancedMinAltitude: 50,
  enhancedMaxAltitude: 170,
};

// One record a second for `seconds`, from `start`.
export const steadyRecords = (
  seconds: number,
  sample: Omit<TestRecord, "timestamp">,
  start: Date = START,
): TestRecord[] =>
  Array.from({ length: seconds + 1 }, (_, i) => ({
    ...sample,
    timestamp: new Date(start.getTime() + i * 1000),
  }));
