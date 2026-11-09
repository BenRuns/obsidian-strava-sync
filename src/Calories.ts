// Estimates the calories burned in an activity from its second-by-second
// heart rate (or, for rides with a power meter, power), using your own
// profile, instead of trusting the device's figure.
//
// Heart rate: Keytel et al. (2005), "Prediction of energy expenditure from
// heart rate monitoring during submaximal exercise", J Sports Sci 23(3).
// Power: the work done on the pedals, at a gross efficiency of about 24%,
// which makes kilojoules of work roughly kilocalories burned.

export type Sex = "male" | "female";

export interface CalorieProfile {
  sex: Sex;
  birthYear: number;
  weightKg: number;
  // ml/kg/min; makes the heart rate estimate more accurate
  vo2max?: number;
}

export type CalorieMethod = "power" | "heart_rate";

export interface CalorieEstimate {
  // Everything burned during the activity, resting burn included
  kcal: number;
  // Burned above resting: what the activity added to your day
  activeKcal: number;
  method: CalorieMethod;
}

export interface CalorieSample {
  timestamp?: Date;
  heart_rate?: number;
  power?: number;
}

const KJ_PER_KCAL = 4.184;
const CYCLING_GROSS_EFFICIENCY = 0.24;
// Samples further apart than this are a pause, not part of the activity.
const MAX_SAMPLE_GAP_SECONDS = 30;
// Below this share of the activity's timer time, there's too little data
// for an estimate.
const MIN_COVERAGE = 0.5;
// Outside these, a reading is a sensor dropout or glitch.
const MIN_HEART_RATE = 30;
const MAX_HEART_RATE = 240;
const MAX_POWER = 3000;

export const ageAt = (profile: CalorieProfile, date: Date): number =>
  date.getUTCFullYear() - profile.birthYear;

// Keytel's equations, in kcal per minute.
export const keytelKcalPerMinute = (
  heartRate: number,
  profile: CalorieProfile,
  age: number,
): number => {
  const { sex, weightKg: w, vo2max } = profile;
  const kjPerMinute =
    vo2max === undefined
      ? sex === "male"
        ? -55.0969 + 0.6309 * heartRate + 0.1988 * w + 0.2017 * age
        : -20.4022 + 0.4472 * heartRate - 0.1263 * w + 0.074 * age
      : sex === "male"
        ? -95.7735 +
          0.634 * heartRate +
          0.404 * vo2max +
          0.394 * w +
          0.271 * age
        : -59.3954 + 0.45 * heartRate + 0.38 * vo2max + 0.103 * w + 0.274 * age;

  return kjPerMinute / KJ_PER_KCAL;
};

// Resting burn (1 MET: 3.5 ml O2/kg/min, about 5 kcal per litre of O2).
// Keytel's equations were fitted to exercise, so at low heart rates they
// fall below this, or even below zero.
export const restingKcalPerMinute = (weightKg: number): number =>
  (3.5 * weightKg) / 200;

const validHeartRate = (hr?: number): hr is number =>
  typeof hr === "number" && hr >= MIN_HEART_RATE && hr <= MAX_HEART_RATE;

const validPower = (power?: number): power is number =>
  typeof power === "number" && power >= 0 && power <= MAX_POWER;

// Adds up `rate` (kcal per second for a sample) over consecutive samples,
// skipping pauses, then scales up for any gaps in the data.
const integrate = (
  samples: CalorieSample[],
  timerSeconds: number,
  rate: (sample: CalorieSample) => number | undefined,
): number | undefined => {
  let kcal = 0;
  let covered = 0;

  for (let i = 0; i < samples.length - 1; i++) {
    const start = samples[i].timestamp;
    const end = samples[i + 1].timestamp;
    if (!(start instanceof Date) || !(end instanceof Date)) {
      continue;
    }
    const seconds = (end.getTime() - start.getTime()) / 1000;
    if (seconds <= 0 || seconds > MAX_SAMPLE_GAP_SECONDS) {
      continue;
    }
    const perSecond = rate(samples[i]);
    if (perSecond === undefined) {
      continue;
    }
    kcal += perSecond * seconds;
    covered += seconds;
  }

  const total = timerSeconds > 0 ? timerSeconds : covered;
  if (covered === 0 || covered / total < MIN_COVERAGE) {
    return undefined;
  }

  return kcal * Math.max(1, total / covered);
};

export interface EstimateOptions {
  start: Date;
  // The activity's timer time, in seconds
  timerSeconds: number;
  // Power only gives calories burned for cycling
  isCycling: boolean;
}

// Power when a ride has it (the most accurate), heart rate otherwise.
// Undefined when the samples don't cover enough of the activity.
export const estimateCalories = (
  samples: CalorieSample[],
  profile: CalorieProfile,
  { start, timerSeconds, isCycling }: EstimateOptions,
): CalorieEstimate | undefined => {
  // The resting burn over the activity's timer time, which you'd have
  // burned anyway, is taken off for the active calories.
  const finish = (kcal: number, method: CalorieMethod): CalorieEstimate => {
    const resting =
      (restingKcalPerMinute(profile.weightKg) * timerSeconds) / 60;
    return {
      kcal: Math.round(kcal),
      activeKcal: Math.max(0, Math.round(kcal - resting)),
      method,
    };
  };

  if (isCycling) {
    const kcal = integrate(samples, timerSeconds, ({ power }) =>
      validPower(power)
        ? power / 1000 / KJ_PER_KCAL / CYCLING_GROSS_EFFICIENCY
        : undefined,
    );
    if (kcal !== undefined) {
      return finish(kcal, "power");
    }
  }

  const age = ageAt(profile, start);
  const resting = restingKcalPerMinute(profile.weightKg);
  const kcal = integrate(samples, timerSeconds, ({ heart_rate }) =>
    validHeartRate(heart_rate)
      ? Math.max(keytelKcalPerMinute(heart_rate, profile, age), resting) / 60
      : undefined,
  );

  return kcal === undefined ? undefined : finish(kcal, "heart_rate");
};
