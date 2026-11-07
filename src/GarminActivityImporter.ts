import type { Activity } from "./Activity";
import { type FitImportResult, FitImporter } from "./FitImporter";
import type { GarminActivitySummary, GarminApi } from "./GarminApi";

const PER_PAGE = 50;
// With no previous import, only the latest activities, like the Strava sync.
const FIRST_IMPORT_COUNT = 30;
// Stop after this many pages (500 activities) in one import.
const MAX_PAGES = 10;

export const garminActivityUrl = (activityId: number) =>
  `https://connect.garmin.com/modern/activity/${activityId}`;

// "2026-10-25 07:30:00" (UTC) in seconds since the epoch.
const startSeconds = (summary: GarminActivitySummary): number | undefined => {
  if (!summary.startTimeGMT) {
    return undefined;
  }
  const time = Date.parse(`${summary.startTimeGMT.replace(" ", "T")}Z`);
  return Number.isNaN(time) ? undefined : time / 1000;
};

// Imports activities from Garmin Connect by downloading each one's original
// FIT file, so they come out the same as importing the FIT files by hand.
export class GarminActivityImporter {
  private garminApi: GarminApi;
  private lastActivityTimestamp?: number;

  constructor(garminApi: GarminApi, lastActivityTimestamp?: number) {
    this.garminApi = garminApi;
    this.lastActivityTimestamp = lastActivityTimestamp;
  }

  async importLatestActivities(): Promise<FitImportResult> {
    const summaries =
      this.lastActivityTimestamp === undefined
        ? await this.garminApi.searchActivities({
            start: 0,
            limit: FIRST_IMPORT_COUNT,
          })
        : await this.activitiesSince(this.lastActivityTimestamp);

    const result: FitImportResult = { activities: [], errors: [] };

    // One at a time, to go easy on Garmin's servers.
    for (const summary of summaries) {
      const name = `Garmin activity ${summary.activityId}`;
      try {
        const data = await this.garminApi.downloadActivity(summary.activityId);
        const { activities, errors } = new FitImporter([
          { name, data },
        ]).import();

        result.activities.push(
          ...activities.map((activity) => this.withSummary(activity, summary)),
        );
        result.errors.push(...errors);
      } catch (error) {
        result.errors.push({
          file: name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async activitiesSince(
    timestamp: number,
  ): Promise<GarminActivitySummary[]> {
    // Searching by date is in whole days, so start a day early to allow for
    // time zones, then keep only activities after the last import.
    const startDate = new Date((timestamp - 86400) * 1000)
      .toISOString()
      .slice(0, 10);
    const summaries: GarminActivitySummary[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const results = await this.garminApi.searchActivities({
        start: page * PER_PAGE,
        limit: PER_PAGE,
        startDate,
      });
      summaries.push(...results);
      if (results.length < PER_PAGE) {
        break;
      }
    }

    return summaries.filter((summary) => {
      const start = startSeconds(summary);
      return start === undefined || start > timestamp;
    });
  }

  // Garmin Connect knows things the FIT file doesn't: the activity's name
  // (which you may have changed), its description and its page.
  private withSummary(
    activity: Activity,
    summary: GarminActivitySummary,
  ): Activity {
    return {
      ...activity,
      name: summary.activityName || activity.name,
      description: summary.description || activity.description,
      url: garminActivityUrl(summary.activityId),
      source: "Garmin",
    };
  }
}
