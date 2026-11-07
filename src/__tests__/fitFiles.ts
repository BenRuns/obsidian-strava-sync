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

// FIT message and field numbers, sizes, types and scales from the FIT profile.
const FILE_ID = 0;
const SESSION = 18;
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

// Builds a FIT activity file in memory, one session per entry. With a UTC
// offset, it also records the device's local time, as watches do.
export const buildFitFile = (
  sessions: TestSession[],
  options: { utcOffsetSeconds?: number } = {},
): ArrayBuffer => {
  const encoder = new FitEncoder().writeMessage(FILE_ID, [
    enumField(0, 4), // activity
    u16(1, 1), // Garmin
    time(4, START),
  ]);

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
