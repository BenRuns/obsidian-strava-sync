import { App, Notice, Setting, requireApiVersion } from "obsidian";
import { DEFAULT_SETTINGS, type Settings } from "../Settings";
import { SettingsTab } from "../SettingsTab";
import type StravaSync from "../StravaSync";

jest.mock("obsidian");

// Obsidian's DOM helper globals, reduced to the text they hold.
interface MockFragment {
  textContent: string;
}

const globals = globalThis as unknown as Record<string, unknown>;

globals.createFragment = (callback: (fragment: unknown) => void) => {
  const parts: string[] = [];
  const fragment = {
    append: (...items: (string | { text?: string })[]) => {
      for (const item of items) {
        parts.push(typeof item === "string" ? item : (item.text ?? ""));
      }
    },
    createEl: (_tag: string, options?: { text?: string }) => ({
      text: options?.text,
    }),
    get textContent() {
      return parts.join("");
    },
  };
  callback(fragment);
  return fragment;
};

type MockSetting = Setting & {
  name: string;
  desc?: string | MockFragment;
  heading: boolean;
  components: {
    value?: string;
    onChangeHandler?: (value: string) => unknown;
    onClickHandler?: () => unknown;
  }[];
  controlEl: { createDiv: jest.Mock };
  settingEl: { empty: jest.Mock; addClass: jest.Mock };
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const descText = (desc: unknown) =>
  typeof desc === "string"
    ? desc
    : (desc as MockFragment | undefined)?.textContent;

describe("SettingsTab", () => {
  let settings: Settings;
  let plugin: StravaSync;
  let settingsTab: SettingsTab;
  let windowOpen: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    settings = structuredClone(DEFAULT_SETTINGS);
    plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      importActivitiesFromCSV: jest.fn().mockResolvedValue(undefined),
      stravaApi: {
        buildAuthorizeUrl: () => "https://www.strava.com/oauth/authorize",
      },
    } as unknown as StravaSync;
    settingsTab = new SettingsTab(new App(), plugin);
    windowOpen = jest.fn();
    globals.window = { open: windowOpen };
  });

  const definitions = () => settingsTab.getSettingDefinitions();

  // Renders the named row the way Obsidian 1.13+ does, from its definition.
  const renderRow = (name: string): MockSetting => {
    for (const group of definitions()) {
      if (!("items" in group) || !group.items) continue;
      for (const item of group.items) {
        if ("name" in item && item.name === name && "render" in item) {
          const setting = new Setting(
            settingsTab.containerEl,
          ) as unknown as MockSetting;
          item.render?.(setting as unknown as Setting, undefined as never);
          return setting;
        }
      }
    }
    throw new Error(`No setting named ${name}`);
  };

  const renderedSettings = () =>
    (settingsTab.containerEl as unknown as { settings: MockSetting[] })
      .settings;

  it("defines the settings in groups", () => {
    const groups = definitions().map((group) => ({
      heading: "heading" in group ? group.heading : undefined,
      items:
        "items" in group
          ? group.items?.map((item) => ("name" in item ? item.name : undefined))
          : undefined,
    }));

    expect(groups).toEqual([
      {
        heading: "Authentication",
        items: [
          "Strava client ID",
          "Strava client secret",
          "Authenticate with Strava",
        ],
      },
      {
        heading: "Sync",
        items: [
          "Folder",
          "Folder date format",
          "Filename",
          "Filename date format",
          "Import Strava bulk export",
        ],
      },
      {
        heading: "Activity",
        items: [
          "Properties / front matter",
          "Activity date format",
          "Activity template",
        ],
      },
      { heading: undefined, items: ["Powered by Strava"] },
    ]);
  });

  it("renders the same rows on older Obsidian versions", () => {
    settingsTab.display();

    const expected = definitions().flatMap((group) => [
      ...("heading" in group && group.heading
        ? [{ name: group.heading, heading: true }]
        : []),
      ...("items" in group && group.items
        ? group.items.map((item) => ({
            name: "name" in item ? item.name : undefined,
            heading: false,
          }))
        : []),
    ]);

    expect(
      renderedSettings().map(({ name, heading }) => ({ name, heading })),
    ).toEqual(expected);
  });

  it("includes link text in descriptions", () => {
    const [authentication] = definitions();
    const clientId =
      "items" in authentication ? authentication.items?.[0] : undefined;

    expect(
      descText(clientId && "desc" in clientId ? clientId.desc : undefined),
    ).toBe("Enter your Strava API client ID (instructions)");
  });

  it.each([
    ["Strava client ID", "abc", () => settings.authentication.stravaClientId],
    [
      "Strava client secret",
      "shh",
      () => settings.authentication.stravaClientSecret,
    ],
    ["Folder", "Runs", () => settings.sync.folder],
    ["Folder date format", "yyyy", () => settings.sync.folderDateFormat],
    ["Filename", "{{name}}", () => settings.sync.filename],
    ["Filename date format", "MM", () => settings.sync.filenameDateFormat],
    [
      "Activity date format",
      "HH:mm",
      () => settings.activity.contentDateFormat,
    ],
  ])("saves %s when it changes", (name, value, read) => {
    const [text] = renderRow(name).components;

    text.onChangeHandler?.(value);

    expect(read()).toBe(value);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("shows the current value in each text field", () => {
    settings.sync.folder = "My activities";

    expect(renderRow("Folder").components[0].value).toBe("My activities");
  });

  it("keeps only valid, unique front matter properties", () => {
    const [textArea] = renderRow("Properties / front matter").components;

    textArea.onChangeHandler?.("name, bogus, distance,name , icon");

    expect(settings.activity.frontMatterProperties).toEqual([
      "name",
      "distance",
      "icon",
    ]);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  describe("activity template", () => {
    it("falls back to the default when cleared", () => {
      settings.activity.template = "custom";
      const [, textArea] = renderRow("Activity template").components;

      textArea.onChangeHandler?.("");

      expect(settings.activity.template).toBe(
        DEFAULT_SETTINGS.activity.template,
      );
    });

    it("resets to the default and refreshes the tab", () => {
      settings.activity.template = "custom";
      const [resetButton] = renderRow("Activity template").components;

      resetButton.onClickHandler?.();

      expect(settings.activity.template).toBe(
        DEFAULT_SETTINGS.activity.template,
      );
      expect(plugin.saveSettings).toHaveBeenCalled();
      expect(settingsTab.update).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Template reset");
    });
  });

  describe("authenticate with Strava", () => {
    it("asks for credentials before opening Strava", () => {
      const [button] = renderRow("Authenticate with Strava").components;

      button.onClickHandler?.();

      expect(windowOpen).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        "🛑 Please enter your Strava client ID and client secret first.",
        8000,
      );
    });

    it("opens the Strava authorize page", () => {
      settings.authentication.stravaClientId = "id";
      settings.authentication.stravaClientSecret = "secret";
      const [button] = renderRow("Authenticate with Strava").components;

      button.onClickHandler?.();

      expect(windowOpen).toHaveBeenCalledWith(
        "https://www.strava.com/oauth/authorize",
        "_blank",
      );
    });

    it("marks the row once authenticated", () => {
      expect(
        renderRow("Authenticate with Strava").controlEl.createDiv,
      ).not.toHaveBeenCalled();

      settings.authentication.stravaAccessToken = "token";

      expect(
        renderRow("Authenticate with Strava").controlEl.createDiv,
      ).toHaveBeenCalledWith({ text: "✅" });
    });
  });

  describe("import Strava bulk export", () => {
    it("imports and reports success", async () => {
      const [button] = renderRow("Import Strava bulk export").components;

      button.onClickHandler?.();
      await flushPromises();

      expect(plugin.importActivitiesFromCSV).toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith(
        "Strava bulk export import completed successfully",
        4000,
      );
    });

    it("reports a failed import", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      (plugin.importActivitiesFromCSV as jest.Mock).mockRejectedValue(
        new Error("boom"),
      );
      const [button] = renderRow("Import Strava bulk export").components;

      button.onClickHandler?.();
      await flushPromises();

      expect(Notice).toHaveBeenCalledWith(
        "Error importing Strava bulk export. Check the console for details.",
        8000,
      );
    });
  });

  it("shows the Powered by Strava logo", () => {
    const setting = renderRow("Powered by Strava");

    expect(setting.settingEl.empty).toHaveBeenCalled();
    expect(setting.settingEl.addClass).toHaveBeenCalledWith(
      "strava-powered-by",
    );
  });

  describe("refresh", () => {
    it("uses update() on Obsidian 1.13+", () => {
      settingsTab.refresh();

      expect(settingsTab.update).toHaveBeenCalled();
      expect(renderedSettings()).toEqual([]);
    });

    it("re-renders the rows on older versions", () => {
      (requireApiVersion as jest.Mock).mockReturnValueOnce(false);

      settingsTab.refresh();

      expect(settingsTab.update).not.toHaveBeenCalled();
      expect(renderedSettings().length).toBeGreaterThan(0);
    });
  });
});
