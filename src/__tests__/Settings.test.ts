import {
  CALORIE_PROPERTIES,
  DEFAULT_SETTINGS,
  type Settings,
  addCalorieProperties,
} from "../Settings";

const withCalories = (calories: Partial<Settings["calories"]>): Settings => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.calories = { ...settings.calories, ...calories };
  return settings;
};

const COMPLETE = { sex: "male" as const, birthYear: 1981, weight: 200 };

describe("addCalorieProperties", () => {
  it("adds the calorie properties once the details are complete", () => {
    const settings = withCalories(COMPLETE);

    expect(addCalorieProperties(settings)).toBe(true);
    expect(settings.activity.frontMatterProperties).toEqual([
      ...DEFAULT_SETTINGS.activity.frontMatterProperties,
      ...CALORIE_PROPERTIES,
    ]);
    expect(settings.calories.addedProperties).toEqual(CALORIE_PROPERTIES);
  });

  it("waits until sex, birth year and weight are all set", () => {
    const settings = withCalories({ sex: "male", birthYear: 1981 });

    expect(addCalorieProperties(settings)).toBe(false);
    expect(settings.activity.frontMatterProperties).toEqual(
      DEFAULT_SETTINGS.activity.frontMatterProperties,
    );
    expect(settings.calories.addedProperties).toBeUndefined();
  });

  it("doesn't add properties already there", () => {
    const settings = withCalories(COMPLETE);
    settings.activity.frontMatterProperties = ["name", "calories"];

    addCalorieProperties(settings);

    expect(settings.activity.frontMatterProperties).toEqual([
      "name",
      "calories",
      "estimated_calories",
      "active_calories",
      "calories_method",
    ]);
  });

  it("only adds them once, so removing them sticks", () => {
    const settings = withCalories(COMPLETE);
    addCalorieProperties(settings);
    settings.activity.frontMatterProperties = ["name"];

    expect(addCalorieProperties(settings)).toBe(false);
    expect(settings.activity.frontMatterProperties).toEqual(["name"]);
  });

  it("adds properties that are new since it last added them", () => {
    // Settings from before active_calories
    const settings = withCalories({ ...COMPLETE, propertiesAdded: true });
    settings.activity.frontMatterProperties = ["name", "estimated_calories"];

    expect(addCalorieProperties(settings)).toBe(true);
    expect(settings.activity.frontMatterProperties).toEqual([
      "name",
      "estimated_calories",
      "active_calories",
    ]);
    expect(settings.calories.addedProperties).toEqual([
      "calories",
      "estimated_calories",
      "calories_method",
      "active_calories",
    ]);
    expect(addCalorieProperties(settings)).toBe(false);
  });

  it("leaves the default settings alone", () => {
    addCalorieProperties(withCalories(COMPLETE));

    expect(DEFAULT_SETTINGS.activity.frontMatterProperties).not.toContain(
      "estimated_calories",
    );
  });
});
