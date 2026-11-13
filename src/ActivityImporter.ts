import type { Activity, Lap } from "./Activity";
import type { StravaActivity, StravaApi, StravaLap } from "./StravaApi";

const mapStravaLap = (lap: StravaLap, index: number): Lap => ({
  number: index + 1,
  name: lap.name,
  elapsed_time: lap.elapsed_time,
  moving_time: lap.moving_time,
  distance: lap.distance,
  average_speed: lap.average_speed || 0,
  max_speed: lap.max_speed || 0,
  average_heart_rate: lap.average_heartrate,
  max_heart_rate: lap.max_heartrate,
  average_cadence: lap.average_cadence,
  average_power: lap.average_watts,
  total_elevation_gain: lap.total_elevation_gain,
});

// The default “non-upload” rate limit allows 100 requests every 15 minutes, with up to 1,000 requests per day.
export class ActivityImporter {
  private readonly PER_PAGE = 30; // Strava API default
  // Up to 3 pages of activities since the last import: with one request per
  // activity, that stays under the limit of 100 requests every 15 minutes.
  private readonly MAX_PAGES = 3;

  private stravaApi: StravaApi;
  private lastActivityTimestamp?: number;

  constructor(stravaApi: StravaApi, lastActivityTimestamp?: number) {
    this.stravaApi = stravaApi;
    this.lastActivityTimestamp = lastActivityTimestamp;
  }

  async importLatestActivities(): Promise<Activity[]> {
    await this.stravaApi.refreshTokenIfExpired();

    try {
      const params: { per_page: number; after?: number } = {
        per_page: this.PER_PAGE,
      };

      if (this.lastActivityTimestamp) {
        params.after = this.lastActivityTimestamp;
      }

      // With no last import, only the latest page
      const maxPages = params.after ? this.MAX_PAGES : 1;
      const activities: StravaActivity[] = [];
      for (let page = 1; page <= maxPages; page++) {
        const results = await this.stravaApi.listActivities({
          ...params,
          page,
        });
        activities.push(...results);
        if (results.length < this.PER_PAGE) {
          break;
        }
      }

      const detailedActivities = await Promise.all(
        activities.map(async (activity) => {
          const detailedActivity = await this.stravaApi.getActivity(
            activity.id,
          );
          return this.mapStravaActivityToActivity(detailedActivity);
        }),
      );

      return detailedActivities;
    } catch (error) {
      console.error("Error fetching activities from Strava:", error);
      throw new Error("Failed to import activities from Strava");
    }
  }

  private mapStravaActivityToActivity(
    stravaActivity: StravaActivity,
  ): Activity {
    return {
      id: stravaActivity.id,
      start_date: new Date(stravaActivity.start_date),
      name: stravaActivity.name,
      sport_type: stravaActivity.sport_type,
      description: stravaActivity.description || "",
      private_note: stravaActivity.private_note || "",
      elapsed_time: stravaActivity.elapsed_time,
      moving_time: stravaActivity.moving_time,
      distance: stravaActivity.distance,
      max_heart_rate: stravaActivity.max_heartrate || 0,
      max_speed: stravaActivity.max_speed || 0,
      average_speed: stravaActivity.average_speed || 0,
      total_elevation_gain: stravaActivity.total_elevation_gain || 0,
      elev_low: stravaActivity.elev_low || 0,
      elev_high: stravaActivity.elev_high || 0,
      calories: stravaActivity.calories || 0,
      url: `https://www.strava.com/activities/${stravaActivity.id}`,
      source: "Strava",
      ...(stravaActivity.laps?.length
        ? { laps: stravaActivity.laps.map(mapStravaLap) }
        : {}),
    };
  }
}
