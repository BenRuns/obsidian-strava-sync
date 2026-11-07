import { requestUrl } from "obsidian";
import { GarminApi, GarminApiError, jwtExpiration } from "../GarminApi";

jest.mock("obsidian");

const mockRequestUrl = requestUrl as jest.Mock;

const NOW_SECONDS = 1_700_000_000;
const BASE_URL = "https://personal.connectapi.garmin.com";

// An unsigned JWT with the given expiry.
const jwt = (exp: number) =>
  ["header", btoa(JSON.stringify({ exp })), "signature"].join(".");

const tokenResponse = (exp = NOW_SECONDS + 86400) => ({
  status: 200,
  text: `${jwt(exp)}\n`,
});

describe("GarminApi", () => {
  let apiKey: string | null;
  let garminApi: GarminApi;

  beforeEach(() => {
    mockRequestUrl.mockReset();
    jest.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000);
    apiKey = "my-api-key";
    garminApi = new GarminApi(() => apiKey);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is authenticated when there is an API key", () => {
    expect(garminApi.isAuthenticated()).toBe(true);

    apiKey = null;
    expect(garminApi.isAuthenticated()).toBe(false);
  });

  describe("searchActivities", () => {
    it("exchanges the API key for a token, then searches", async () => {
      mockRequestUrl
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce({
          status: 200,
          text: "[...]",
          json: [{ activityId: 1 }],
        });

      const activities = await garminApi.searchActivities({
        start: 50,
        limit: 50,
        startDate: "2026-10-24",
      });

      expect(activities).toEqual([{ activityId: 1 }]);
      expect(mockRequestUrl.mock.calls[0][0]).toEqual({
        url: `${BASE_URL}/personalapitoken-service/personal-api/personal-api-key/token`,
        method: "POST",
        headers: { Accept: "*/*", Authorization: "ApiKey my-api-key" },
        throw: false,
      });
      expect(mockRequestUrl.mock.calls[1][0]).toEqual({
        url: `${BASE_URL}/activitylist-service/activities/search/activities?start=50&limit=50&startDate=2026-10-24`,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${jwt(NOW_SECONDS + 86400)}`,
        },
        throw: false,
      });
    });

    it("leaves out the start date when there isn't one", async () => {
      mockRequestUrl
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce({ status: 200, text: "", json: null });

      const activities = await garminApi.searchActivities({
        start: 0,
        limit: 30,
      });

      expect(activities).toEqual([]);
      expect(mockRequestUrl.mock.calls[1][0].url).toBe(
        `${BASE_URL}/activitylist-service/activities/search/activities?start=0&limit=30`,
      );
    });
  });

  describe("access token", () => {
    const search = () => garminApi.searchActivities({ start: 0, limit: 1 });
    const searchResponse = { status: 200, text: "[]", json: [] };

    it("reuses the token until it is about to expire", async () => {
      mockRequestUrl
        .mockResolvedValueOnce(tokenResponse(NOW_SECONDS + 120))
        .mockResolvedValue(searchResponse);

      await search();
      await search();
      expect(mockRequestUrl).toHaveBeenCalledTimes(3);

      // Within a minute of expiring: get a new one.
      (Date.now as jest.Mock).mockReturnValue((NOW_SECONDS + 61) * 1000);
      mockRequestUrl.mockResolvedValueOnce(tokenResponse());
      await search();
      expect(mockRequestUrl).toHaveBeenCalledTimes(5);
      expect(mockRequestUrl.mock.calls[3][0].method).toBe("POST");
    });

    it("explains a rejected API key", async () => {
      mockRequestUrl.mockResolvedValueOnce({ status: 401, text: "" });

      await expect(search()).rejects.toThrow(
        "Garmin rejected the API key. It may be wrong or expired",
      );
    });

    it("needs an API key", async () => {
      apiKey = null;

      await expect(search()).rejects.toThrow(GarminApiError);
      expect(mockRequestUrl).not.toHaveBeenCalled();
    });

    it("rejects a token that isn't a JWT", async () => {
      mockRequestUrl.mockResolvedValueOnce({ status: 200, text: "nonsense" });

      await expect(search()).rejects.toThrow(
        "Garmin did not return a valid access token",
      );
    });
  });

  it("reports Garmin limiting requests", async () => {
    mockRequestUrl
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ status: 429, text: "" });

    await expect(
      garminApi.searchActivities({ start: 0, limit: 1 }),
    ).rejects.toThrow("Garmin is limiting requests right now");
  });

  it("downloads an activity's original file", async () => {
    const zip = new ArrayBuffer(4);
    mockRequestUrl
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ status: 200, arrayBuffer: zip });

    expect(await garminApi.downloadActivity(42)).toBe(zip);
    expect(mockRequestUrl.mock.calls[1][0]).toMatchObject({
      url: `${BASE_URL}/download-service/files/activity/42`,
      headers: {
        Accept:
          "application/zip, application/x-zip-compressed, application/octet-stream",
      },
    });
  });

  it("reports failed downloads", async () => {
    mockRequestUrl
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ status: 404 });

    await expect(garminApi.downloadActivity(42)).rejects.toThrow(
      "Garmin request failed (HTTP 404)",
    );
  });

  it("reads a JWT's expiry", () => {
    expect(jwtExpiration(jwt(123))).toBe(123);
    expect(() => jwtExpiration("a.b.c")).toThrow(GarminApiError);
  });
});
