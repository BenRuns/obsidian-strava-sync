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
});
