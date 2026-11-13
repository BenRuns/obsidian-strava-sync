import * as Handlebars from "handlebars";
import { DateTime } from "luxon";
import { stringifyYaml } from "obsidian";
import type { Activity } from "./Activity";

// Templates have these helpers on top of Handlebars' own:
// {{duration seconds}}        3725 → "1:02:05"
// {{km metres}}               5012 → "5.01"
// {{pace speed sport_type}}   metres a second → "5:30 /km" on foot,
//                             "1:45 /100m" swimming, otherwise "24.3 km/h"
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

export const pace = (speed: unknown, sportType: unknown): string => {
  if (!isNumber(speed) || speed <= 0) {
    return "";
  }
  const sport = typeof sportType === "string" ? sportType.toLowerCase() : "";
  if (FOOT_SPORTS.has(sport)) {
    return `${clock(1000 / speed)} /km`;
  }
  if (sport === "swim") {
    return `${clock(100 / speed)} /100m`;
  }
  return `${(speed * 3.6).toFixed(1)} km/h`;
};

handlebars.registerHelper("duration", duration);
handlebars.registerHelper("km", km);
handlebars.registerHelper("pace", pace);

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

// Earlier default templates. Settings still holding one are moved to
// DEFAULT_TEMPLATE.
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

export class ActivityRenderer {
  template: string;
  dateFormat: string;
  frontMatterProperties?: string[];

  constructor(
    template: string,
    dateFormat: string,
    frontMatterProperties?: string[],
  ) {
    this.template = template;
    this.dateFormat = dateFormat;
    this.frontMatterProperties = frontMatterProperties;
  }

  render(activity: Activity) {
    const start_date = DateTime.fromJSDate(
      new Date(activity.start_date),
    ).toFormat(this.dateFormat);

    const bodyContent = handlebars.compile(this.template)({
      ...activity,
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
