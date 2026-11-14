import type { Activity, Lap } from "../Activity";
import {
  ActivityRenderer,
  DEFAULT_TEMPLATE,
  LEGACY_DEFAULT_TEMPLATE,
  PREVIOUS_DEFAULT_TEMPLATE,
  dist,
  duration,
  km,
  lapType,
  pace,
} from "../ActivityRenderer";

jest.mock("obsidian", () => ({
  stringifyYaml: jest.fn().mockImplementation((obj) => {
    // Simple YAML-like string representation
    return Object.entries(obj)
      .map(([key, value]) => `${key}: ${value}\n`)
      .join("");
  }),
}));

jest.mock("luxon", () => ({
  DateTime: {
    fromJSDate: jest.fn().mockReturnValue({
      toFormat: jest.fn().mockReturnValue("2023-04-15 10:30:00"),
    }),
  },
}));

describe("ActivityRenderer", () => {
  let activity: Activity;

  beforeEach(() => {
    activity = {
      id: 123456789,
      start_date: new Date("2023-04-15T10:30:00Z"),
      name: "Morning Run",
      sport_type: "Run",
      description: "Great run in the park",
      private_note: "Felt strong today",
      elapsed_time: 3600,
      moving_time: 3500,
      distance: 10000,
      max_heart_rate: 180,
      max_speed: 4.5,
      average_speed: 4,
      total_elevation_gain: 100,
      elev_low: 50,
      elev_high: 150,
      calories: 500,
      url: "https://www.strava.com/activities/123456789",
      source: "Strava",
    };
  });

  test("renders Strava activities the same as the old default template", () => {
    const render = (template: string) =>
      new ActivityRenderer(template, "yyyy-MM-dd HH:mm:ss").render(activity);

    expect(render(DEFAULT_TEMPLATE)).toBe(render(LEGACY_DEFAULT_TEMPLATE));

    activity.description = "";
    activity.private_note = "";
    expect(render(DEFAULT_TEMPLATE)).toBe(render(LEGACY_DEFAULT_TEMPLATE));
  });

  test("renders a Garmin activity with its link and tag", () => {
    activity.url = "https://connect.garmin.com/modern/activity/42";
    activity.source = "Garmin";
    activity.private_note = "";

    const result = new ActivityRenderer(
      DEFAULT_TEMPLATE,
      "yyyy-MM-dd HH:mm:ss",
    ).render(activity);

    expect(result).toBe(`# Morning Run

[https://connect.garmin.com/modern/activity/42](https://connect.garmin.com/modern/activity/42)

Description: Great run in the park

#Garmin
`);
  });

  test("leaves out the link for activities without one", () => {
    activity.url = undefined;
    activity.source = "FIT";
    activity.description = "";
    activity.private_note = "";

    const result = new ActivityRenderer(
      DEFAULT_TEMPLATE,
      "yyyy-MM-dd HH:mm:ss",
    ).render(activity);

    expect(result).toBe("# Morning Run\n\n#FIT\n");
  });

  test("tags activities without a source as Strava", () => {
    activity.source = undefined;

    expect(
      new ActivityRenderer("#{{source}}", "yyyy-MM-dd HH:mm:ss").render(
        activity,
      ),
    ).toBe("#Strava");
  });

  test("renders activity with default template", () => {
    const renderer = new ActivityRenderer(
      DEFAULT_TEMPLATE,
      "yyyy-MM-dd HH:mm:ss",
    );
    const result = renderer.render(activity);

    const expected = `# Morning Run

[https://www.strava.com/activities/123456789](https://www.strava.com/activities/123456789)

Description: Great run in the park

> [!NOTE] Private note
> Felt strong today

#Strava
`;

    expect(result).toBe(expected);
  });

  test("renders activity with custom template", () => {
    const customTemplate = `
Activity: {{name}}
Date: {{start_date}}
Sport Type: {{sport_type}}
Distance: {{distance}} meters
Time: {{elapsed_time}} seconds
Description: {{description}}
`;
    const renderer = new ActivityRenderer(
      customTemplate,
      "yyyy-MM-dd HH:mm:ss",
    );
    const result = renderer.render(activity);

    const expected = `
Activity: Morning Run
Date: 2023-04-15 10:30:00
Sport Type: Run
Distance: 10000 meters
Time: 3600 seconds
Description: Great run in the park
`;

    expect(result).toBe(expected);
  });

  test("renders front matter", () => {
    const renderer = new ActivityRenderer(
      DEFAULT_TEMPLATE,
      "yyyy-MM-dd HH:mm:ss",
      ["id", "name", "sport_type", "distance"],
    );
    const result = renderer.render(activity);

    const expected = `---
id: 123456789
name: Morning Run
sport_type: Run
distance: 10000
---
# Morning Run

[https://www.strava.com/activities/123456789](https://www.strava.com/activities/123456789)

Description: Great run in the park

> [!NOTE] Private note
> Felt strong today

#Strava
`;

    expect(result).toBe(expected);
  });

  test("formats date correctly", () => {
    const renderer = new ActivityRenderer(
      "{{start_date}}",
      "yyyy-MM-dd HH:mm:ss",
    );
    const result = renderer.render(activity);

    const expected = "2023-04-15 10:30:00";

    expect(result).toBe(expected);
  });

  test("renders activity with missing description", () => {
    const activityWithoutDescription = { ...activity };
    activityWithoutDescription.description = "";

    const renderer = new ActivityRenderer(
      DEFAULT_TEMPLATE,
      "yyyy-MM-dd HH:mm:ss",
    );
    const result = renderer.render(activityWithoutDescription);

    const expected = `# Morning Run

[https://www.strava.com/activities/123456789](https://www.strava.com/activities/123456789)

> [!NOTE] Private note
> Felt strong today

#Strava
`;

    expect(result).toBe(expected);
  });

  test("renders activity with missing private note", () => {
    const activityWithoutPrivateNote = { ...activity };
    activityWithoutPrivateNote.private_note = "";

    const renderer = new ActivityRenderer(
      DEFAULT_TEMPLATE,
      "yyyy-MM-dd HH:mm:ss",
    );
    const result = renderer.render(activityWithoutPrivateNote);

    const expected = `# Morning Run

[https://www.strava.com/activities/123456789](https://www.strava.com/activities/123456789)

Description: Great run in the park

#Strava
`;

    expect(result).toBe(expected);
  });

  test("renders activity icon in frontmatter and content", () => {
    const customTemplate = `
# {{icon}} {{name}}
Sport Type: {{sport_type}}
`;
    const renderer = new ActivityRenderer(
      customTemplate,
      "yyyy-MM-dd HH:mm:ss",
      ["icon"],
    );
    const result = renderer.render(activity);

    const expected = `---
id: 123456789
icon: 🏃
---

# 🏃 Morning Run
Sport Type: Run
`;

    expect(result).toBe(expected);
  });

  test("renders correct icons for different sport types", () => {
    const template = "{{icon}} {{sport_type}}";
    const renderer = new ActivityRenderer(template, "yyyy-MM-dd HH:mm:ss");

    const testCases = [
      { sport_type: "Run", expectedIcon: "🏃" },
      { sport_type: "Ride", expectedIcon: "🚴" },
      { sport_type: "Swim", expectedIcon: "🏊" },
      { sport_type: "AlpineSki", expectedIcon: "⛷️" },
      { sport_type: "Golf", expectedIcon: "⛳" },
      { sport_type: "Hike", expectedIcon: "🥾" },
      { sport_type: "Walk", expectedIcon: "🚶" },
      { sport_type: "Snowboard", expectedIcon: "🏂" },
      { sport_type: "Workout", expectedIcon: "🏋️" },
      { sport_type: "Yoga", expectedIcon: "🧘" },
      { sport_type: "UnknownActivity", expectedIcon: "🏅" },
    ];

    testCases.forEach(({ sport_type, expectedIcon }) => {
      const testActivity = { ...activity, sport_type };
      const result = renderer.render(testActivity);
      expect(result).toBe(`${expectedIcon} ${sport_type}`);
    });
  });

  describe("laps", () => {
    const lap = (number: number, extra: Partial<Lap> = {}): Lap => ({
      number,
      elapsed_time: 300,
      moving_time: 290,
      distance: 1000,
      average_speed: 1000 / 290,
      max_speed: 4.2,
      ...extra,
    });
    const render = () =>
      new ActivityRenderer(DEFAULT_TEMPLATE, "yyyy-MM-dd HH:mm:ss").render(
        activity,
      );

    test("renders a table of laps, with workout steps", () => {
      activity.workout_name = "2026-11-12 Tempo";
      activity.laps = [
        lap(1, {
          step: "Warm up",
          intensity: "warmup",
          average_heart_rate: 130,
        }),
        lap(2, {
          step: "Threshold",
          step_notes: "3 mi @ T pace",
          intensity: "active",
          average_power: 380,
        }),
        lap(3, { step: "Stride", step_notes: "Stride" }),
        lap(4, { intensity: "recovery" }),
        lap(5),
      ];

      expect(render()).toContain(`Workout: 2026-11-12 Tempo

## Laps

| Lap | Type | Time | Distance | Pace | Avg HR | Avg power |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Warm up | 4:50 | 1.00 km | 4:50 /km | 130 |  |
| 2 | Threshold (3 mi @ T pace) | 4:50 | 1.00 km | 4:50 /km |  | 380 |
| 3 | Stride | 4:50 | 1.00 km | 4:50 /km |  |  |
| 4 | Recovery | 4:50 | 1.00 km | 4:50 /km |  |  |
| 5 |  | 4:50 | 1.00 km | 4:50 /km |  |  |

#Strava`);
    });

    test("leaves out the Type column when laps have no types", () => {
      activity.laps = [lap(1, { intensity: "active" }), lap(2)];

      expect(render()).toContain(`## Laps

| Lap | Time | Distance | Pace | Avg HR | Avg power |
| --- | --- | --- | --- | --- | --- |
| 1 | 4:50 | 1.00 km | 4:50 /km |  |  |
| 2 | 4:50 | 1.00 km | 4:50 /km |  |  |

#Strava`);
    });

    test("shows distances and paces in miles when set", () => {
      activity.laps = [
        lap(1, {
          distance: 1609.344,
          moving_time: 480,
          average_speed: 1609.344 / 480,
        }),
        lap(2, {
          distance: 804.672,
          moving_time: 240,
          average_speed: 804.672 / 240,
        }),
      ];

      expect(
        new ActivityRenderer(
          DEFAULT_TEMPLATE,
          "yyyy-MM-dd HH:mm:ss",
          undefined,
          "mi",
        ).render(activity),
      ).toContain(`| 1 | 8:00 | 1.00 mi | 8:00 /mi |  |  |
| 2 | 4:00 | 0.50 mi | 8:00 /mi |  |  |`);
    });

    test("names lap types", () => {
      expect(lapType(lap(1, { intensity: "cooldown" }))).toBe("Cool-down");
      expect(lapType(lap(1, { intensity: "other" }))).toBe("");
      expect(lapType(lap(1, { step: "Fast | slow" }))).toBe("Fast / slow");
    });

    test("leaves out the table for a single lap, as before laps", () => {
      const before = new ActivityRenderer(
        PREVIOUS_DEFAULT_TEMPLATE,
        "yyyy-MM-dd HH:mm:ss",
      ).render(activity);
      expect(render()).toBe(before);

      activity.laps = [lap(1)];
      expect(render()).toBe(before);
    });

    test("formats durations, distances and paces", () => {
      expect(duration(3725)).toBe("1:02:05");
      expect(duration(59.6)).toBe("1:00");
      expect(duration(undefined)).toBe("");
      expect(km(5012)).toBe("5.01");
      expect(km(undefined)).toBe("");
      expect(pace(1000 / 330, "Run")).toBe("5:30 /km");
      expect(pace(100 / 105, "Swim")).toBe("1:45 /100m");
      expect(pace(6.75, "Ride")).toBe("24.3 km/h");
      expect(pace(0, "Run")).toBe("");
      expect(dist(1609.344, "mi")).toBe("1.00 mi");
      expect(dist(5012)).toBe("5.01 km");
      expect(dist(undefined, "mi")).toBe("");
      expect(pace(1609.344 / 480, "Run", "mi")).toBe("8:00 /mi");
      expect(pace(91.44 / 100, "Swim", "mi")).toBe("1:40 /100yd");
      expect(pace(8.9408, "Ride", "mi")).toBe("20.0 mph");
    });
  });
});
