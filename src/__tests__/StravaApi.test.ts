import { requestUrl } from "obsidian";
import type { AuthenticationSettings } from "../Settings";
import { StravaApi } from "../StravaApi";

jest.mock("obsidian");

const mockRequestUrl = requestUrl as jest.Mock;

const NOW_SECONDS = 1_700_000_000;

describe("StravaApi", () => {
  let settings: AuthenticationSettings;
  let stravaApi: StravaApi;

  beforeEach(() => {
    mockRequestUrl.mockReset();
    jest.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000);

    settings = {
      stravaClientId: "client-id",
      stravaClientSecret: "client-secret",
      stravaAccessToken: "access-token",
      stravaRefreshToken: "refresh-token",
      stravaTokenExpiresAt: NOW_SECONDS + 3600,
    };
    stravaApi = new StravaApi(settings);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("isAuthenticated", () => {
    it("is true when all tokens are present", () => {
      expect(stravaApi.isAuthenticated()).toBe(true);
    });

    it.each([
      "stravaAccessToken",
      "stravaRefreshToken",
      "stravaTokenExpiresAt",
    ] as const)("is false when %s is missing", (key) => {
      settings[key] = undefined;
      expect(stravaApi.isAuthenticated()).toBe(false);
    });
  });

  it("builds the authorize URL", () => {
    const url = new URL(stravaApi.buildAuthorizeUrl());

    expect(url.origin + url.pathname).toBe(
      "https://www.strava.com/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: "obsidian://strava-sync",
      response_type: "code",
      scope: "read,activity:read_all",
      approval_prompt: "force",
    });
  });

  it("exchanges an authorization code for tokens", async () => {
    mockRequestUrl.mockResolvedValue({
      json: {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_at: 123,
      },
    });

    await stravaApi.exchangeCodeForToken("auth-code");

    const request = mockRequestUrl.mock.calls[0][0];
    expect(request.url).toBe("https://www.strava.com/oauth/token");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "authorization_code",
      code: "auth-code",
    });
    expect(settings.stravaAccessToken).toBe("new-access");
    expect(settings.stravaRefreshToken).toBe("new-refresh");
    expect(settings.stravaTokenExpiresAt).toBe(123);
  });

  describe("refreshTokenIfExpired", () => {
    it("throws when not authenticated", async () => {
      settings.stravaAccessToken = undefined;

      await expect(stravaApi.refreshTokenIfExpired()).rejects.toThrow(
        "Not authenticated",
      );
      expect(mockRequestUrl).not.toHaveBeenCalled();
    });

    it("does nothing while the token is valid", async () => {
      await stravaApi.refreshTokenIfExpired();

      expect(mockRequestUrl).not.toHaveBeenCalled();
    });

    it("refreshes an expired token", async () => {
      settings.stravaTokenExpiresAt = NOW_SECONDS - 1;
      mockRequestUrl.mockResolvedValue({
        json: {
          access_token: "refreshed-access",
          refresh_token: "refreshed-refresh",
          expires_at: NOW_SECONDS + 21600,
        },
      });

      await stravaApi.refreshTokenIfExpired();

      expect(JSON.parse(mockRequestUrl.mock.calls[0][0].body)).toEqual({
        client_id: "client-id",
        client_secret: "client-secret",
        grant_type: "refresh_token",
        refresh_token: "refresh-token",
      });
      expect(settings.stravaAccessToken).toBe("refreshed-access");
      expect(settings.stravaRefreshToken).toBe("refreshed-refresh");
      expect(settings.stravaTokenExpiresAt).toBe(NOW_SECONDS + 21600);
    });
  });

  describe("listActivities", () => {
    it("passes the query parameters and access token", async () => {
      mockRequestUrl.mockResolvedValue({ json: [{ id: 1 }] });

      const activities = await stravaApi.listActivities({
        per_page: 30,
        after: 1234,
      });

      expect(activities).toEqual([{ id: 1 }]);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: "https://www.strava.com/api/v3/athlete/activities?per_page=30&after=1234",
        headers: { Authorization: "Bearer access-token" },
      });
    });

    it("leaves out after when it isn't given", async () => {
      mockRequestUrl.mockResolvedValue({ json: [] });

      await stravaApi.listActivities({ per_page: 30 });

      expect(mockRequestUrl.mock.calls[0][0].url).toBe(
        "https://www.strava.com/api/v3/athlete/activities?per_page=30",
      );
    });
  });

  it("gets a single activity", async () => {
    mockRequestUrl.mockResolvedValue({ json: { id: 42 } });

    const activity = await stravaApi.getActivity(42);

    expect(activity).toEqual({ id: 42 });
    expect(mockRequestUrl).toHaveBeenCalledWith({
      url: "https://www.strava.com/api/v3/activities/42",
      headers: { Authorization: "Bearer access-token" },
    });
  });
});
