import { requestUrl } from "obsidian";
import type { AuthenticationSettings } from "./Settings";

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface StravaActivity {
  id: number;
  start_date: string;
  name: string;
  sport_type: string;
  description?: string;
  private_note?: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  max_heartrate?: number;
  max_speed?: number;
  average_speed?: number;
  total_elevation_gain?: number;
  elev_low?: number;
  elev_high?: number;
  calories?: number;
}

export class StravaApi {
  private readonly SCOPES = "read,activity:read_all";
  private readonly REDIRECT_URI = "obsidian://strava-sync";

  settings: AuthenticationSettings;

  constructor(settings: AuthenticationSettings) {
    this.settings = settings;
  }

  isAuthenticated(): boolean {
    return !!(
      this.settings.stravaAccessToken &&
      this.settings.stravaRefreshToken &&
      this.settings.stravaTokenExpiresAt
    );
  }

  buildAuthorizeUrl(): string {
    const params = new URLSearchParams({
      client_id: this.settings.stravaClientId,
      redirect_uri: this.REDIRECT_URI,
      response_type: "code",
      scope: this.SCOPES,
      approval_prompt: "force",
    });

    return `https://www.strava.com/oauth/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string) {
    this.updateTokens(
      await this.tokenRequest({
        grant_type: "authorization_code",
        code: code,
      }),
    );
  }

  async refreshTokenIfExpired(): Promise<void> {
    if (!this.isAuthenticated()) {
      throw new Error(
        "Not authenticated. Please authenticate with Strava first.",
      );
    }

    if (Date.now() / 1000 > (this.settings.stravaTokenExpiresAt ?? 0)) {
      await this.refreshToken();
    }
  }

  private async refreshToken() {
    if (!this.settings.stravaRefreshToken) {
      throw new Error("No refresh token available. Please re-authenticate.");
    }

    this.updateTokens(
      await this.tokenRequest({
        grant_type: "refresh_token",
        refresh_token: this.settings.stravaRefreshToken,
      }),
    );
  }

  private async tokenRequest(
    params: Record<string, string>,
  ): Promise<StravaTokenResponse> {
    const response = await requestUrl({
      url: "https://www.strava.com/oauth/token",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.settings.stravaClientId,
        client_secret: this.settings.stravaClientSecret,
        ...params,
      }),
    });

    return response.json as StravaTokenResponse;
  }

  private updateTokens(response: StravaTokenResponse) {
    this.settings.stravaAccessToken = response.access_token;
    this.settings.stravaRefreshToken = response.refresh_token;
    this.settings.stravaTokenExpiresAt = response.expires_at;
  }

  async listActivities(params: { per_page: number; after?: number }): Promise<
    StravaActivity[]
  > {
    await this.refreshTokenIfExpired();
    const queryParams = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ).toString();
    const response = await requestUrl({
      url: `https://www.strava.com/api/v3/athlete/activities?${queryParams}`,
      headers: {
        Authorization: `Bearer ${this.settings.stravaAccessToken}`,
      },
    });

    return response.json as StravaActivity[];
  }

  async getActivity(id: number): Promise<StravaActivity> {
    await this.refreshTokenIfExpired();
    const response = await requestUrl({
      url: `https://www.strava.com/api/v3/activities/${id}`,
      headers: {
        Authorization: `Bearer ${this.settings.stravaAccessToken}`,
      },
    });

    return response.json as StravaActivity;
  }
}
