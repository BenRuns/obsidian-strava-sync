import * as fs from "node:fs";
import * as path from "node:path";
import { ActivityImporter } from "../ActivityImporter";
import type { AuthenticationSettings } from "../Settings";
import { StravaApi } from "../StravaApi";

jest.mock("../StravaApi");

describe("ActivityImporter", () => {
  let activityImporter: ActivityImporter;
  let mockStravaApi: jest.Mocked<StravaApi>;

  beforeEach(() => {
    mockStravaApi = new StravaApi(
      {} as AuthenticationSettings,
    ) as jest.Mocked<StravaApi>;
    mockStravaApi.refreshTokenIfExpired = jest
      .fn()
      .mockResolvedValue(undefined);
    activityImporter = new ActivityImporter(mockStravaApi);
  });

  it("should import latest activities", async () => {
    const mockActivitiesList = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../assets/activities.json"),
        "utf8",
      ),
    );
    const mockActivity1 = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../assets/activity_12271989718.json"),
        "utf8",
      ),
    );
    const mockActivity2 = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../assets/activity_12288940553.json"),
        "utf8",
      ),
    );
    const mockActivity3 = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../assets/activity_12315055573.json"),
        "utf8",
      ),
    );

    (mockStravaApi.listActivities as jest.Mock).mockResolvedValue(
      mockActivitiesList,
    );
    (mockStravaApi.getActivity as jest.Mock)
      .mockResolvedValueOnce(mockActivity1)
      .mockResolvedValueOnce(mockActivity2)
      .mockResolvedValueOnce(mockActivity3);

    const activities = await activityImporter.importLatestActivities();

    expect(mockStravaApi.refreshTokenIfExpired).toHaveBeenCalled();
    expect(mockStravaApi.listActivities).toHaveBeenCalledTimes(1);
    expect(mockStravaApi.listActivities).toHaveBeenCalledWith({
      per_page: 30,
      page: 1,
    });
    expect(mockStravaApi.getActivity).toHaveBeenCalledTimes(3);

    expect(activities).toHaveLength(3);
    expect(activities[0]).toMatchObject({
      id: 12271989718,
      name: "Lunch Run",
      sport_type: "Run",
      start_date: new Date("2024-08-24T10:47:26Z"),
      elapsed_time: 1955,
      distance: 4551.3,
    });

    expect(activities[1]).toMatchObject({
      id: 12288940553,
      name: "Dynamo Challenge 2024",
      sport_type: "Ride",
      start_date: new Date("2024-08-28T05:07:43Z"),
      elapsed_time: 38846,
      distance: 154081.0,
    });

    expect(activities[2]).toMatchObject({
      id: 12315055573,
      name: "Lunch Swim",
      sport_type: "Swim",
      start_date: new Date("2024-09-09T10:23:12Z"),
      elapsed_time: 1697,
      distance: 1000.0,
    });
  });

  describe("since the last import", () => {
    const page = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: i + 1 }));

    beforeEach(() => {
      (mockStravaApi.getActivity as jest.Mock).mockImplementation((id) =>
        Promise.resolve({ id, start_date: "2026-10-25T07:30:00Z" }),
      );
      activityImporter = new ActivityImporter(mockStravaApi, 1234);
    });

    it("pages through new activities", async () => {
      (mockStravaApi.listActivities as jest.Mock)
        .mockResolvedValueOnce(page(30))
        .mockResolvedValueOnce(page(5));

      const activities = await activityImporter.importLatestActivities();

      expect(
        (mockStravaApi.listActivities as jest.Mock).mock.calls.map(
          ([params]) => params,
        ),
      ).toEqual([
        { per_page: 30, after: 1234, page: 1 },
        { per_page: 30, after: 1234, page: 2 },
      ]);
      expect(activities).toHaveLength(35);
    });

    it("stops after 3 pages, to stay under Strava's rate limit", async () => {
      (mockStravaApi.listActivities as jest.Mock).mockResolvedValue(page(30));

      const activities = await activityImporter.importLatestActivities();

      expect(mockStravaApi.listActivities).toHaveBeenCalledTimes(3);
      expect(activities).toHaveLength(90);
    });
  });

  it("imports laps from the detailed activity", async () => {
    (mockStravaApi.listActivities as jest.Mock).mockResolvedValue([{ id: 1 }]);
    (mockStravaApi.getActivity as jest.Mock).mockResolvedValue({
      id: 1,
      start_date: "2026-10-25T07:30:00Z",
      name: "Track session",
      sport_type: "Run",
      elapsed_time: 900,
      moving_time: 880,
      distance: 3000,
      laps: [
        {
          name: "Lap 1",
          elapsed_time: 300,
          moving_time: 295,
          distance: 1000,
          average_speed: 3.39,
          max_speed: 4.2,
          average_heartrate: 150.4,
          max_heartrate: 165,
          average_cadence: 88,
          average_watts: 310,
          total_elevation_gain: 2,
        },
        { name: "Lap 2", elapsed_time: 600, moving_time: 585, distance: 2000 },
      ],
    });

    const [activity] = await activityImporter.importLatestActivities();

    expect(activity.laps).toEqual([
      {
        number: 1,
        name: "Lap 1",
        elapsed_time: 300,
        moving_time: 295,
        distance: 1000,
        average_speed: 3.39,
        max_speed: 4.2,
        average_heart_rate: 150.4,
        max_heart_rate: 165,
        average_cadence: 88,
        average_power: 310,
        total_elevation_gain: 2,
      },
      expect.objectContaining({ number: 2, name: "Lap 2", distance: 2000 }),
    ]);
  });

  it("has no laps when Strava has none", async () => {
    (mockStravaApi.listActivities as jest.Mock).mockResolvedValue([{ id: 1 }]);
    (mockStravaApi.getActivity as jest.Mock).mockResolvedValue({
      id: 1,
      start_date: "2026-10-25T07:30:00Z",
      name: "Run",
      sport_type: "Run",
      elapsed_time: 900,
      moving_time: 880,
      distance: 3000,
      laps: [],
    });

    const [activity] = await activityImporter.importLatestActivities();

    expect(activity.laps).toBeUndefined();
  });
});
