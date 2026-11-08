import { requestUrl } from "obsidian";

// Garmin Connect Personal API: read-only access to your own Garmin data with
// a Personal API key you create in Garmin Connect.
// https://developer.garmin.com/gc-developer-program/personal/personal-api/
const BASE_URL = "https://personal.connectapi.garmin.com";
const TOKEN_PATH =
  "/personalapitoken-service/personal-api/personal-api-key/token";

// Get a new token this long before the current one expires.
const TOKEN_REFRESH_WINDOW_SECONDS = 60;

export interface GarminActivitySummary {
  activityId: number;
  activityName?: string;
  description?: string;
  startTimeGMT?: string; // "2026-10-25 07:30:00"
}

export class GarminApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GarminApiError";
  }
}

// The `exp` claim of a JWT, in seconds since the epoch. The signature isn't
// checked: the token is only ever sent back to Garmin.
export const jwtExpiration = (token: string): number => {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload)) as { exp?: unknown };
    if (typeof exp === "number") {
      return exp;
    }
  } catch {
    // Reported below
  }

  throw new GarminApiError("Garmin did not return a valid access token");
};

export class GarminApi {
  private getApiKey: () => string | null;
  private token?: { value: string; expiresAt: number };

  constructor(getApiKey: () => string | null) {
    this.getApiKey = getApiKey;
  }

  isAuthenticated(): boolean {
    return !!this.getApiKey();
  }

  // Exchanges the API key for a bearer token, reusing it until it expires.
  private async accessToken(): Promise<string> {
    if (
      this.token &&
      this.token.expiresAt - Date.now() / 1000 > TOKEN_REFRESH_WINDOW_SECONDS
    ) {
      return this.token.value;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new GarminApiError(
        "No Garmin API key. Please add one in the plugin settings.",
      );
    }

    const response = await requestUrl({
      url: `${BASE_URL}${TOKEN_PATH}`,
      method: "POST",
      headers: { Accept: "*/*", Authorization: `ApiKey ${apiKey}` },
      throw: false,
    });

    if (response.status === 401 || response.status === 403) {
      throw new GarminApiError(
        "Garmin rejected the API key. It may be wrong or expired: create a new one in Garmin Connect.",
      );
    }
    if (response.status >= 400) {
      throw new GarminApiError(
        `Garmin sign-in failed (HTTP ${response.status})`,
      );
    }

    const value = response.text.trim();
    this.token = { value, expiresAt: jwtExpiration(value) };
    return value;
  }

  private async get(path: string, accept = "application/json") {
    const response = await requestUrl({
      url: `${BASE_URL}${path}`,
      headers: {
        Accept: accept,
        Authorization: `Bearer ${await this.accessToken()}`,
      },
      throw: false,
    });

    if (response.status === 429) {
      throw new GarminApiError(
        "Garmin is limiting requests right now. Try again later.",
      );
    }
    if (response.status >= 400) {
      throw new GarminApiError(
        `Garmin request failed (HTTP ${response.status})`,
      );
    }

    return response;
  }

  // Newest first, `limit` at a time from offset `start`.
  async searchActivities(params: {
    start: number;
    limit: number;
    startDate?: string; // YYYY-MM-DD
  }): Promise<GarminActivitySummary[]> {
    const query = new URLSearchParams({
      start: String(params.start),
      limit: String(params.limit),
    });
    if (params.startDate) {
      query.set("startDate", params.startDate);
    }

    const response = await this.get(
      `/activitylist-service/activities/search/activities?${query.toString()}`,
    );

    return (response.text ? response.json : []) as GarminActivitySummary[];
  }

  // The activity's original file, as a zip containing the FIT file.
  async downloadActivity(activityId: number): Promise<ArrayBuffer> {
    const response = await this.get(
      `/download-service/files/activity/${activityId}`,
      "application/zip, application/x-zip-compressed, application/octet-stream",
    );

    return response.arrayBuffer;
  }
}
