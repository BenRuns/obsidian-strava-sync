import * as Handlebars from "handlebars";
import { DateTime } from "luxon";
import { stringifyYaml } from "obsidian";
import type { Activity, Lap } from "./Activity";
import type { DistanceUnit } from "./Settings";

// Templates have these helpers on top of Handlebars' own:
// {{duration seconds}}        3725 → "1:02:05"
// {{dist metres}}             in the distance unit set: "5.01 km" or "3.11 mi"
// {{km metres}}               5012 → "5.01"
// {{pace speed sport_type}}   metres a second → "5:30 /km" (or "/mi") on
//                             foot, "1:45 /100m" (or "/100yd") swimming,
//                             otherwise "24.3 km/h" (or "mph")
const handlebars = Handlebars.create();

const FOOT_SPORTS = new Set([
  "run",
  "trailrun",
  "virtualrun",
  "walk",
  "hike",
  "snowshoe",
]);

const clock = (totalSeconds: number): string => {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = String(rounded % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const duration = (seconds: unknown): string =>
  isNumber(seconds) && seconds >= 0 ? clock(seconds) : "";

export const km = (metres: unknown): string =>
  isNumber(metres) ? (metres / 1000).toFixed(2) : "";

const METRES_PER_MILE = 1609.344;
const METRES_PER_100_YARDS = 91.44;

export const dist = (metres: unknown, unit: DistanceUnit = "km"): string => {
  if (!isNumber(metres)) {
    return "";
  }
  return unit === "mi"
    ? `${(metres / METRES_PER_MILE).toFixed(2)} mi`
    : `${km(metres)} km`;
};

export const pace = (
  speed: unknown,
  sportType: unknown,
  unit: DistanceUnit = "km",
): string => {
  if (!isNumber(speed) || speed <= 0) {
    return "";
  }
  const miles = unit === "mi";
  const sport = typeof sportType === "string" ? sportType.toLowerCase() : "";
  if (FOOT_SPORTS.has(sport)) {
    return miles
      ? `${clock(METRES_PER_MILE / speed)} /mi`
      : `${clock(1000 / speed)} /km`;
  }
  if (sport === "swim") {
    return miles
      ? `${clock(METRES_PER_100_YARDS / speed)} /100yd`
      : `${clock(100 / speed)} /100m`;
  }
  return miles
    ? `${((speed * 3600) / METRES_PER_MILE).toFixed(1)} mph`
    : `${(speed * 3.6).toFixed(1)} km/h`;
};

// The distance unit set, which the renderer passes in with the activity.
const unitOf = (options: Handlebars.HelperOptions): DistanceUnit => {
  const root = (options?.data as { root?: { distance_unit?: unknown } })?.root;
  return root?.distance_unit === "mi" ? "mi" : "km";
};

handlebars.registerHelper("duration", duration);
handlebars.registerHelper("km", km);
handlebars.registerHelper(
  "dist",
  (metres: unknown, options: Handlebars.HelperOptions) =>
    dist(metres, unitOf(options)),
);
handlebars.registerHelper(
  "pace",
  (speed: unknown, sportType: unknown, options: Handlebars.HelperOptions) =>
    pace(speed, sportType, unitOf(options)),
);

const INTENSITY_LABELS: Record<string, string> = {
  active: "Active",
  rest: "Rest",
  warmup: "Warm-up",
  cooldown: "Cool-down",
  recovery: "Recovery",
  interval: "Interval",
};

// What a lap was, for the Type column: its workout step, with the step's
// notes if they say more, e.g. "Threshold (3 mi @ T pace)"; otherwise its
// intensity, e.g. "Recovery".
export const lapType = (lap: Lap): string => {
  const notes =
    lap.step_notes && lap.step_notes !== lap.step ? ` (${lap.step_notes})` : "";
  const type = lap.step
    ? `${lap.step}${notes}`
    : (INTENSITY_LABELS[lap.intensity ?? ""] ?? "");
  // A | would end the table cell
  return type.replace(/\|/g, "/");
};

// Whether laps' types say anything: devices that mark every lap "active"
// don't.
const hasLapTypes = (laps: Lap[]): boolean =>
  laps.some(
    (lap) =>
      lap.step ||
      (lap.intensity &&
        INTENSITY_LABELS[lap.intensity] &&
        lap.intensity !== "active"),
  );

export const DEFAULT_TEMPLATE = `# {{name}}
{{#if url}}

[{{url}}]({{url}})
{{/if}}
{{#if description}}

Description: {{description}}
{{/if}}
{{#if private_note}}

> [!NOTE] Private note
> {{private_note}}
{{/if}}
{{#if workout_name}}

Workout: {{workout_name}}
{{/if}}
{{#if laps.[1]}}

## Laps

{{#if lap_types}}
| Lap | Type | Time | Distance | Pace | Avg HR | Avg power |
| --- | --- | --- | --- | --- | --- | --- |
{{#each laps}}
| {{number}} | {{type}} | {{duration moving_time}} | {{dist distance}} | {{pace average_speed ../sport_type}} | {{average_heart_rate}} | {{average_power}} |
{{/each}}
{{else}}
| Lap | Time | Distance | Pace | Avg HR | Avg power |
| --- | --- | --- | --- | --- | --- |
{{#each laps}}
| {{number}} | {{duration moving_time}} | {{dist distance}} | {{pace average_speed ../sport_type}} | {{average_heart_rate}} | {{average_power}} |
{{/each}}
{{/if}}
{{/if}}

#{{source}}
`;

// Earlier default templates. Settings still holding one are moved to
// DEFAULT_TEMPLATE.
// Unreleased: with workout steps, before distance units
export const STEPS_DEFAULT_TEMPLATE = `# {{name}}
{{#if url}}

[{{url}}]({{url}})
{{/if}}
{{#if description}}

Description: {{description}}
{{/if}}
{{#if private_note}}

> [!NOTE] Private note
> {{private_note}}
{{/if}}
{{#if workout_name}}

Workout: {{workout_name}}
{{/if}}
{{#if laps.[1]}}

## Laps

{{#if lap_types}}
| Lap | Type | Time | Distance | Pace | Avg HR | Avg power |
| --- | --- | --- | --- | --- | --- | --- |
{{#each laps}}
| {{number}} | {{type}} | {{duration moving_time}} | {{km distance}} km | {{pace average_speed ../sport_type}} | {{average_heart_rate}} | {{average_power}} |
{{/each}}
{{else}}
| Lap | Time | Distance | Pace | Avg HR | Avg power |
| --- | --- | --- | --- | --- | --- |
{{#each laps}}
| {{number}} | {{duration moving_time}} | {{km distance}} km | {{pace average_speed ../sport_type}} | {{average_heart_rate}} | {{average_power}} |
{{/each}}
{{/if}}
{{/if}}

#{{source}}
`;

// Unreleased: the first laps template, before workout steps
export const LAPS_DEFAULT_TEMPLATE = `# {{name}}
{{#if url}}

[{{url}}]({{url}})
{{/if}}
{{#if description}}

Description: {{description}}
{{/if}}
{{#if private_note}}

> [!NOTE] Private note
> {{private_note}}
{{/if}}
{{#if laps.[1]}}

## Laps

| Lap | Type | Time | Distance | Pace | Avg HR | Avg power |
| --- | --- | --- | --- | --- | --- | --- |
{{#each laps}}
| {{number}} | {{intensity}} | {{duration moving_time}} | {{km distance}} km | {{pace average_speed ../sport_type}} | {{average_heart_rate}} | {{average_power}} |
{{/each}}
{{/if}}

#{{source}}
`;

// 2.0.0, before laps
export const PREVIOUS_DEFAULT_TEMPLATE = `# {{name}}
{{#if url}}

[{{url}}]({{url}})
{{/if}}
{{#if description}}

Description: {{description}}
{{/if}}
{{#if private_note}}

> [!NOTE] Private note
> {{private_note}}
{{/if}}

#{{source}}
`;

// Before activities came from more than Strava
export const LEGACY_DEFAULT_TEMPLATE = `# {{name}}

[https://www.strava.com/activities/{{id}}](https://www.strava.com/activities/{{id}})
{{#if description}}

Description: {{description}}
{{/if}}
{{#if private_note}}

> [!NOTE] Private note
> {{private_note}}
{{/if}}

#Strava
`;

export const OLD_DEFAULT_TEMPLATES = [
  LEGACY_DEFAULT_TEMPLATE,
  PREVIOUS_DEFAULT_TEMPLATE,
  LAPS_DEFAULT_TEMPLATE,
  STEPS_DEFAULT_TEMPLATE,
];

export class ActivityRenderer {
  template: string;
  dateFormat: string;
  frontMatterProperties?: string[];
  distanceUnit: DistanceUnit;

  constructor(
    template: string,
    dateFormat: string,
    frontMatterProperties?: string[],
    distanceUnit: DistanceUnit = "km",
  ) {
    this.template = template;
    this.dateFormat = dateFormat;
    this.frontMatterProperties = frontMatterProperties;
    this.distanceUnit = distanceUnit;
  }

  render(activity: Activity) {
    const start_date = DateTime.fromJSDate(
      new Date(activity.start_date),
    ).toFormat(this.dateFormat);

    const laps = activity.laps?.map((lap) => ({ ...lap, type: lapType(lap) }));

    const bodyContent = handlebars.compile(this.template)({
      ...activity,
      laps,
      lap_types: laps ? hasLapTypes(laps) : false,
      distance_unit: this.distanceUnit,
      start_date: start_date,
      source: activity.source ?? "Strava",
      icon: this.getActivityIcon(activity.sport_type),
    });

    return (
      (this.frontMatterProperties ? this.renderFrontMatter(activity) : "") +
      bodyContent
    );
  }

  renderFrontMatter(activity: Activity) {
    const frontMatter: { [id: string]: unknown } = {
      id: activity.id,
    };

    this.frontMatterProperties?.forEach((property) => {
      frontMatter[property] =
        property === "icon"
          ? this.getActivityIcon(activity.sport_type)
          : activity[property];
    });

    return `---\n${stringifyYaml(frontMatter)}---\n`;
  }

  private getActivityIcon(sportType: string): string {
    switch (sportType.toLowerCase()) {
      case "alpineski":
      case "backcountryski":
      case "nordicski":
      case "rollerski":
        return "⛷️";
      case "badminton":
        return "🏸";
      case "canoeing":
      case "kayaking":
        return "🛶";
      case "crossfit":
      case "weighttraining":
      case "workout":
        return "🏋️";
      case "ebikeride":
      case "ride":
      case "gravelride":
      case "velomobile":
      case "virtualride":
        return "🚴";
      case "elliptical":
      case "stairstepper":
      case "walk":
        return "🚶";
      case "emountainbikeride":
      case "mountainbikeride":
        return "🚵";
      case "golf":
        return "⛳";
      case "handcycle":
      case "wheelchair":
        return "🦽";
      case "highintensityintervaltraining":
        return "🏃";
      case "hike":
        return "🥾";
      case "iceskate":
        return "⛸️";
      case "inlineskate":
        return "🛼";
      case "kitesurf":
      case "windsurf":
      case "standuppaddling":
      case "surfing":
        return "🏄";
      case "pickleball":
      case "tabletennis":
        return "🏓";
      case "pilates":
      case "yoga":
        return "🧘";
      case "rockclimbing":
        return "🧗";
      case "rowing":
      case "virtualrow":
        return "🚣";
      case "run":
      case "trailrun":
      case "virtualrun":
        return "🏃";
      case "sail":
        return "⛵";
      case "skateboard":
        return "🛹";
      case "snowboard":
        return "🏂";
      case "snowshoe":
        return "🥾";
      case "soccer":
        return "⚽";
      case "squash":
      case "racquetball":
      case "tennis":
        return "🎾";
      case "swim":
        return "🏊";
      default:
        return "🏅";
    }
  }
}
