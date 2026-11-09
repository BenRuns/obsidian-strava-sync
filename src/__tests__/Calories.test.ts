import {
  type CalorieProfile,
  type CalorieSample,
  ageAt,
  estimateCalories,
  keytelKcalPerMinute,
  restingKcalPerMinute,
} from "../Calories";

const START = new Date("2026-10-25T07:30:00Z");

const MALE: CalorieProfile = { sex: "male", birthYear: 1991, weightKg: 75 };
const FEMALE: CalorieProfile = { sex: "female", birthYear: 1991, weightKg: 60 };

// One sample a second for `seconds`.
const steady = (
  seconds: number,
  sample: Omit<CalorieSample, "timestamp">,
  start = START,
): CalorieSample[] =>
  Array.from({ length: seconds + 1 }, (_, i) => ({
    ...sample,
    timestamp: new Date(start.getTime() + i * 1000),
  }));

const options = { start: START, timerSeconds: 3600, isCycling: false };

describe("keytelKcalPerMinute", () => {
  it("matches Keytel's equation for men", () => {
    // (-55.0969 + 0.6309 * 150 + 0.1988 * 75 + 0.2017 * 35) / 4.184
    expect(keytelKcalPerMinute(150, MALE, 35)).toBeCloseTo(14.7007, 3);
  });

  it("matches Keytel's equation for women", () => {
    // (-20.4022 + 0.4472 * 150 - 0.1263 * 60 + 0.074 * 35) / 4.184
    expect(keytelKcalPerMinute(150, FEMALE, 35)).toBeCloseTo(9.9641, 3);
  });

  it("uses the VO2 max equations when VO2 max is known", () => {
    // (-95.7735 + 0.634 * 150 + 0.404 * 50 + 0.394 * 75 + 0.271 * 35) / 4.184
    expect(keytelKcalPerMinute(150, { ...MALE, vo2max: 50 }, 35)).toBeCloseTo(
      13.9965,
      3,
    );
    // (-59.3954 + 0.45 * 150 + 0.38 * 45 + 0.103 * 60 + 0.274 * 35) / 4.184
    expect(keytelKcalPerMinute(150, { ...FEMALE, vo2max: 45 }, 35)).toBeCloseTo(
      9.7932,
      3,
    );
  });
});

describe("ageAt", () => {
  it("is the age in the year of the activity", () => {
    expect(ageAt(MALE, START)).toBe(35);
  });
});

describe("estimateCalories", () => {
  it("adds up heart rate over the activity", () => {
    const estimate = estimateCalories(
      steady(3600, { heart_rate: 150 }),
      MALE,
      options,
    );

    expect(estimate).toEqual({
      kcal: Math.round(14.7007 * 60),
      // Less resting burn: 3.5 * 75 / 200 kcal a minute for 60 minutes
      activeKcal: Math.round(14.7007 * 60 - 1.3125 * 60),
      method: "heart_rate",
    });
  });

  it("never goes below resting burn at low heart rates", () => {
    const estimate = estimateCalories(
      steady(3600, { heart_rate: 60 }),
      MALE,
      options,
    );

    expect(keytelKcalPerMinute(60, MALE, 35)).toBeLessThan(
      restingKcalPerMinute(75),
    );
    expect(estimate?.kcal).toBe(Math.round(restingKcalPerMinute(75) * 60));
  });

  it("skips pauses, and readings that are dropouts", () => {
    const firstHalf = steady(1800, { heart_rate: 150 });
    // A 10 minute pause, then the second half
    const secondHalf = steady(
      1800,
      { heart_rate: 150 },
      new Date(START.getTime() + 2400 * 1000),
    );
    const withDropouts = [...firstHalf, ...secondHalf].map((sample, i) =>
      i % 100 === 0 ? { ...sample, heart_rate: 0 } : sample,
    );

    const steadyKcal = estimateCalories(
      steady(3600, { heart_rate: 150 }),
      MALE,
      options,
    )?.kcal;

    expect(estimateCalories(withDropouts, MALE, options)?.kcal).toBe(
      steadyKcal,
    );
  });

  it("scales up for short gaps in the data", () => {
    // Heart rate for 45 of the 60 minutes
    const samples = steady(3600, { heart_rate: 150 }).map((sample, i) =>
      i % 4 === 0 ? { timestamp: sample.timestamp } : sample,
    );

    expect(estimateCalories(samples, MALE, options)?.kcal).toBe(
      Math.round(14.7007 * 60),
    );
  });

  it("never has negative active calories", () => {
    expect(
      estimateCalories(steady(3600, { heart_rate: 40 }), MALE, options)
        ?.activeKcal,
    ).toBe(0);
  });

  it("gives no estimate with heart rate for under half the activity", () => {
    expect(
      estimateCalories(steady(1700, { heart_rate: 150 }), MALE, options),
    ).toBeUndefined();
    expect(estimateCalories([], MALE, options)).toBeUndefined();
  });

  it("uses power for rides that have it", () => {
    // 200 W for an hour is 720 kJ of work
    const estimate = estimateCalories(
      steady(3600, { heart_rate: 150, power: 200 }),
      MALE,
      { ...options, isCycling: true },
    );

    expect(estimate).toEqual({
      kcal: Math.round(720 / 4.184 / 0.24),
      activeKcal: Math.round(720 / 4.184 / 0.24 - 1.3125 * 60),
      method: "power",
    });
  });

  it("uses heart rate for rides without power, and other sports", () => {
    expect(
      estimateCalories(steady(3600, { heart_rate: 150 }), MALE, {
        ...options,
        isCycling: true,
      })?.method,
    ).toBe("heart_rate");
    // Running power isn't work done on pedals
    expect(
      estimateCalories(
        steady(3600, { heart_rate: 150, power: 250 }),
        MALE,
        options,
      )?.method,
    ).toBe("heart_rate");
  });
});
