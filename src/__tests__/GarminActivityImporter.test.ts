import { zipSync } from "fflate";
import { GarminActivityImporter } from "../GarminActivityImporter";
import type { GarminApi } from "../GarminApi";
import { RUN, START, buildFitFile } from "./fitFiles";

// Garmin's downloads: a zip holding the activity's FIT file.
const zippedFitFile = (activityId: number, startTime = START) => {
  const bytes = zipSync({
    [`${activityId}_ACTIVITY.fit`]: new Uint8Array(
      buildFitFile([{ ...RUN, startTime }]),
    ),
  });
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
};

const summary = (activityId: number, startTimeGMT: string) => ({
  activityId,
  activityName: `Activity ${activityId}`,
  startTimeGMT,
});

describe("GarminActivityImporter", () => {
  let garminApi: {
    searchActivities: jest.Mock;
    downloadActivity: jest.Mock;
  };

  beforeEach(() => {
    garminApi = {
      searchActivities: jest.fn().mockResolvedValue([]),
      downloadActivity: jest
        .fn()
        .mockImplementation((id: number) => Promise.resolve(zippedFitFile(id))),
    };
  });

  const importer = (lastActivityTimestamp?: number) =>
    new GarminActivityImporter(
      garminApi as unknown as GarminApi,
      lastActivityTimestamp,
    );

  it("imports the latest 30 activities the first time", async () => {
    garminApi.searchActivities.mockResolvedValue([
      {
        activityId: 42,
        activityName: "Forest Park Running",
        description: "Hilly",
        startTimeGMT: "2026-10-25 07:30:00",
      },
    ]);

    const { activities, errors } = await importer().importLatestActivities();

    expect(garminApi.searchActivities).toHaveBeenCalledWith({
      start: 0,
      limit: 30,
    });
    expect(garminApi.downloadActivity).toHaveBeenCalledWith(42);
    expect(errors).toEqual([]);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      id: START.getTime() / 1000,
      name: "Forest Park Running",
      description: "Hilly",
      sport_type: "TrailRun",
      distance: 10000,
      url: "https://connect.garmin.com/modern/activity/42",
      source: "Garmin",
    });
  });

  it("keeps the generated name when Garmin has none", async () => {
    garminApi.searchActivities.mockResolvedValue([{ activityId: 42 }]);

    const { activities } = await importer().importLatestActivities();

    expect(activities[0].name).toMatch(/ Trail Run$/);
    expect(activities[0].description).toBe("");
  });

  it("imports only activities after the last import", async () => {
    const last = Date.parse("2026-10-25T07:30:00Z") / 1000;
    garminApi.searchActivities.mockResolvedValue([
      summary(3, "2026-10-26 06:00:00"),
      summary(2, "2026-10-25 07:30:00"),
      summary(1, "2026-10-24 18:00:00"),
    ]);

    await importer(last).importLatestActivities();

    // A day early, to allow for time zones.
    expect(garminApi.searchActivities).toHaveBeenCalledWith({
      start: 0,
      limit: 50,
      startDate: "2026-10-24",
    });
    expect(garminApi.downloadActivity.mock.calls).toEqual([[3]]);
  });

  it("pages through the search results", async () => {
    const last = Date.parse("2026-01-01T00:00:00Z") / 1000;
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        summary(offset + i + 1, "2026-10-25 07:30:00"),
      );
    garminApi.searchActivities
      .mockResolvedValueOnce(page(0, 50))
      .mockResolvedValueOnce(page(50, 50))
      .mockResolvedValueOnce(page(100, 3));

    await importer(last).importLatestActivities();

    expect(
      garminApi.searchActivities.mock.calls.map(([params]) => params.start),
    ).toEqual([0, 50, 100]);
    expect(garminApi.downloadActivity).toHaveBeenCalledTimes(103);
  });

  it("stops after 10 pages", async () => {
    garminApi.searchActivities.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) =>
        summary(i + 1, "2026-10-25 07:30:00"),
      ),
    );

    await importer(0).importLatestActivities();

    expect(garminApi.searchActivities).toHaveBeenCalledTimes(10);
  });

  it("reports activities that fail and imports the rest", async () => {
    garminApi.searchActivities.mockResolvedValue([
      { activityId: 1 },
      { activityId: 2 },
    ]);
    garminApi.downloadActivity.mockImplementation((id: number) =>
      id === 1
        ? Promise.reject(new Error("Garmin request failed (HTTP 500)"))
        : Promise.resolve(zippedFitFile(id)),
    );

    const { activities, errors } = await importer().importLatestActivities();

    expect(activities).toHaveLength(1);
    expect(errors).toEqual([
      {
        file: "Garmin activity 1",
        message: "Garmin request failed (HTTP 500)",
      },
    ]);
  });

  it("downloads one activity at a time", async () => {
    garminApi.searchActivities.mockResolvedValue([
      { activityId: 1 },
      { activityId: 2 },
    ]);
    let downloading = 0;
    let mostAtOnce = 0;
    garminApi.downloadActivity.mockImplementation(async (id: number) => {
      downloading++;
      mostAtOnce = Math.max(mostAtOnce, downloading);
      await new Promise((resolve) => setImmediate(resolve));
      downloading--;
      return zippedFitFile(id);
    });

    await importer().importLatestActivities();

    expect(mostAtOnce).toBe(1);
  });
});
