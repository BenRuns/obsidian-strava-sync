import {
  App,
  Notice,
  SecretComponent,
  Setting,
  requireApiVersion,
} from "obsidian";
import type PhysicalActivityImporter from "../PhysicalActivityImporter";
import { DEFAULT_SETTINGS, type Settings } from "../Settings";
import { SettingsTab } from "../SettingsTab";

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
  let plugin: PhysicalActivityImporter;
  let settingsTab: SettingsTab;
  let windowOpen: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    settings = structuredClone(DEFAULT_SETTINGS);
    plugin = {
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      importActivitiesFromCSV: jest.fn().mockResolvedValue(undefined),
      getGarminApiKey: jest.fn().mockReturnValue(null),
      setGarminApiKey: jest.fn().mockResolvedValue(undefined),
      setGarminApiKeyName: jest.fn().mockResolvedValue(undefined),
      setStravaClientSecretName: jest.fn().mockResolvedValue(undefined),
      openReimportModal: jest.fn(),
      stravaApi: {
        buildAuthorizeUrl: () => "https://www.strava.com/oauth/authorize",
      },
    } as unknown as PhysicalActivityImporter;
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
      { heading: "Activity source", items: ["Import new activities from"] },
      { heading: "Garmin", items: ["Garmin API key"] },
      {
        heading: "Strava",
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
          "Re-import activities",
          "Import Strava bulk export",
          "Import FIT files",
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

    const visible = (group: { visible?: boolean | (() => boolean) }) =>
      typeof group.visible === "function"
        ? group.visible()
        : group.visible !== false;

    const expected = definitions()
      .filter((group) => !("type" in group) || visible(group))
      .flatMap((group) => [
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
    const strava = definitions()[2];
    const clientId = "items" in strava ? strava.items?.[0] : undefined;

    expect(
      descText(clientId && "desc" in clientId ? clientId.desc : undefined),
    ).toBe("Enter your Strava API client ID (instructions)");
  });

  it.each([
    ["Strava client ID", "abc", () => settings.authentication.stravaClientId],
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

  it("opens the re-import dialog", () => {
    const [button] = renderRow("Re-import activities").components;

    button.onClickHandler?.();

    expect(plugin.openReimportModal).toHaveBeenCalled();
  });

  it("imports FIT files", () => {
    (plugin as unknown as Record<string, unknown>).importActivitiesFromFIT =
      jest.fn().mockResolvedValue(undefined);
    const [button] = renderRow("Import FIT files").components;

    button.onClickHandler?.();

    expect(plugin.importActivitiesFromFIT).toHaveBeenCalled();
  });

  describe("activity source", () => {
    const groupVisible = (heading: string) => {
      const group = definitions().find(
        (item) => "heading" in item && item.heading === heading,
      );
      return group && "visible" in group && typeof group.visible === "function"
        ? group.visible()
        : undefined;
    };

    it("shows the Strava settings for Strava", () => {
      expect(groupVisible("Strava")).toBe(true);
      expect(groupVisible("Garmin")).toBe(false);
    });

    it("shows the Garmin settings for Garmin", () => {
      settings.sync.source = "garmin";

      expect(groupVisible("Strava")).toBe(false);
      expect(groupVisible("Garmin")).toBe(true);
    });

    it("shows the Powered by Strava logo only for Strava", () => {
      const logoVisible = () => {
        const group = definitions().at(-1);
        return group &&
          "visible" in group &&
          typeof group.visible === "function"
          ? group.visible()
          : undefined;
      };

      expect(logoVisible()).toBe(true);

      settings.sync.source = "garmin";
      expect(logoVisible()).toBe(false);
    });

    it("saves a new source and refreshes the tab", () => {
      const [dropdown] = renderRow("Import new activities from").components;

      expect(dropdown.value).toBe("strava");

      dropdown.onChangeHandler?.("garmin");

      expect(settings.sync.source).toBe("garmin");
      expect(plugin.saveSettings).toHaveBeenCalled();
      expect(settingsTab.update).toHaveBeenCalled();
    });

    it("mentions that Strava needs a subscription", () => {
      const [dropdown] = renderRow("Import new activities from")
        .components as unknown as { options: Record<string, string> }[];

      expect(dropdown.options).toEqual({
        strava: "Strava (needs a Strava subscription)",
        garmin: "Garmin",
      });
    });
  });

  describe.each([
    {
      row: "Garmin API key",
      nameSetting: "garminApiKeyName" as const,
      setName: "setGarminApiKeyName" as const,
    },
    {
      row: "Strava client secret",
      nameSetting: "stravaClientSecretName" as const,
      setName: "setStravaClientSecretName" as const,
    },
  ])("$row, with secret storage", ({ row, nameSetting, setName }) => {
    it("picks a secret by name", () => {
      settings.authentication[nameSetting] = "my-secret";
      const [picker] = renderRow(row).components;

      expect(picker).toBeInstanceOf(SecretComponent);
      expect(picker.value).toBe("my-secret");
    });

    it("saves the chosen secret's name", () => {
      const [picker] = renderRow(row).components;

      picker.onChangeHandler?.("other-secret");

      expect(plugin[setName]).toHaveBeenCalledWith("other-secret");
    });
  });

  describe("without secret storage (before Obsidian 1.11.4)", () => {
    beforeEach(() => {
      (requireApiVersion as jest.Mock).mockReturnValue(false);
    });

    afterEach(() => {
      (requireApiVersion as jest.Mock).mockReturnValue(true);
    });

    it("takes the Garmin API key itself", () => {
      (plugin.getGarminApiKey as jest.Mock).mockReturnValue("secret-key");
      const [text] = renderRow("Garmin API key").components;

      expect(text).not.toBeInstanceOf(SecretComponent);
      expect(text.value).toBe("secret-key");

      text.onChangeHandler?.("new-key");
      expect(plugin.setGarminApiKey).toHaveBeenCalledWith("new-key");
    });

    it("takes the Strava client secret itself", () => {
      const [text] = renderRow("Strava client secret").components;

      text.onChangeHandler?.("shh");

      expect(settings.authentication.stravaClientSecret).toBe("shh");
      expect(plugin.saveSettings).toHaveBeenCalled();
    });
  });

  it("shows Strava's Connect with Strava button", () => {
    const setting = renderRow("Authenticate with Strava") as unknown as {
      classes: string[];
    };

    expect(setting.classes).toEqual([
      "physical-activity-importer-strava-connect",
    ]);
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
