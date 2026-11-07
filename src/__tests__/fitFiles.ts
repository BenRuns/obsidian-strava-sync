// FIT activity files built in memory for tests.
import {
  type Encodable,
  Encoder,
  type FileIdMesg,
  Profile,
  type SessionMesg,
} from "@garmin/fitsdk";

export const START = new Date("2026-10-25T07:30:00Z");

// Builds a FIT activity file in memory, one session per entry.
export const buildFitFile = (sessions: Partial<SessionMesg>[]): ArrayBuffer => {
  const fileId: Encodable<FileIdMesg> = {
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "activity",
    manufacturer: "garmin",
    product: 0,
    timeCreated: START,
    serialNumber: 1234,
  };
  const encoder = new Encoder().writeMesg(fileId);
  for (const session of sessions) {
    const mesg: Encodable<SessionMesg> = {
      mesgNum: Profile.MesgNum.SESSION,
      ...session,
    };
    encoder.writeMesg(mesg);
  }
  const bytes = encoder.close();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
};

export const RUN: Partial<SessionMesg> = {
  timestamp: new Date(START.getTime() + 3700 * 1000),
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
