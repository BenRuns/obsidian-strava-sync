import {
  type App,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
  type SettingDefinitionItem,
  requireApiVersion,
} from "obsidian";
import type PhysicalActivityImporter from "./PhysicalActivityImporter";
import {
  type ActivitySource,
  DEFAULT_SETTINGS,
  type DistanceUnit,
  VALID_FRONT_MATTER_PROPERTIES,
  type WeightUnit,
  addCalorieProperties,
} from "./Settings";

// A number typed into a setting, or undefined if it's blank or not positive.
const positiveNumber = (value: string): number | undefined => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const LUXON_FORMAT_URL =
  "https://moment.github.io/luxon/#/formatting?id=table-of-tokens";
const SYNC_CONFIGURATION_URL =
  "https://github.com/BenRuns/physical-activity-importer?tab=readme-ov-file#sync-configuration";
const GARMIN_PERSONAL_API_URL =
  "https://developer.garmin.com/gc-developer-program/personal/personal-api/";

// One list of settings, rendered two ways: as declarative definitions on
// Obsidian 1.13+ (getSettingDefinitions, which also puts them in Obsidian's
// settings search), and row by row by display() on older versions.
interface SettingRow {
  name: string;
  desc?: string | DocumentFragment;
  searchable?: boolean;
  render: (setting: Setting) => unknown;
}

interface SettingSection {
  heading?: string;
  visible?: () => boolean;
  rows: SettingRow[];
}

// Description text followed by a link and closing text.
const linkedDesc = (
  before: string,
  linkText: string,
  href: string,
  after: string,
) =>
  createFragment((fragment) => {
    fragment.append(
      before,
      fragment.createEl("a", { text: linkText, href }),
      after,
    );
  });

export class SettingsTab extends PluginSettingTab {
  plugin: PhysicalActivityImporter;

  constructor(app: App, plugin: PhysicalActivityImporter) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Obsidian 1.13+ renders these, and skips display().
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map(({ heading, visible, rows }) => ({
      type: "group" as const,
      heading,
      visible,
      items: rows.map(({ name, desc, searchable, render }) => ({
        name,
        desc,
        searchable,
        render: (setting: Setting) => {
          render(setting);
        },
      })),
    }));
  }

  // Older Obsidian: the same rows, built by hand.
  display(): void {
    this.renderRows();
  }

  // Adds the calorie properties when the tab closes, not while you're
  // still typing your details in.
  hide(): void {
    super.hide();
    if (addCalorieProperties(this.plugin.settings)) {
      void this.plugin.saveSettings();
    }
  }

  private renderRows(): void {
    const { containerEl } = this;

    containerEl.empty();

    for (const { heading, visible, rows } of this.sections()) {
      if (visible && !visible()) {
        continue;
      }
      if (heading) {
        new Setting(containerEl).setName(heading).setHeading();
      }
      for (const row of rows) {
        const setting = new Setting(containerEl).setName(row.name);
        if (row.desc) {
          setting.setDesc(row.desc);
        }
        row.render(setting);
      }
    }
  }

  // Rebuilds the tab after a change that alters what rows show.
  refresh(): void {
    if (requireApiVersion("1.13.0")) {
      this.update();
    } else {
      this.renderRows();
    }
  }

  private async importCSV(): Promise<void> {
    try {
      await this.plugin.importActivitiesFromCSV();
      new Notice("Strava bulk export import completed successfully", 4000);
    } catch (error) {
      console.error("Error importing Strava bulk export:", error);
      new Notice(
        "Error importing Strava bulk export. Check the console for details.",
        8000,
      );
    }
  }

  private sections(): SettingSection[] {
    const settings = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();
    const usesSource = (source: ActivitySource) => () =>
      settings.sync.source === source;

    return [
      {
        heading: "Activity source",
        rows: [
          {
            name: "Import new activities from",
            desc: "Strava or Garmin, one at a time. Strava's API needs a paid Strava subscription (since June 2026); Garmin's Personal API is free. Importing a Strava bulk export or FIT files works with either.",
            render: (setting) =>
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOption("strava", "Strava (needs a Strava subscription)")
                  .addOption("garmin", "Garmin")
                  .setValue(settings.sync.source)
                  .onChange((value) => {
                    settings.sync.source = value as ActivitySource;
                    save();
                    this.refresh();
                  }),
              ),
          },
        ],
      },
      {
        heading: "Garmin",
        visible: usesSource("garmin"),
        rows: [
          {
            name: "Garmin API key",
            desc: linkedDesc(
              "Create a Personal API key in Garmin Connect (",
              "Garmin's guide",
              GARMIN_PERSONAL_API_URL,
              "), then choose the secret holding it, or create one. Keys expire after 30 to 365 days, depending on what you choose.",
            ),
            // Obsidian's secret storage where it has one: this saves only
            // the secret's name. Before 1.11.4, the key itself.
            render: (setting) =>
              requireApiVersion("1.11.4")
                ? setting.addComponent((el) =>
                    new SecretComponent(this.app, el)
                      .setValue(settings.authentication.garminApiKeyName ?? "")
                      .onChange((name) => {
                        void this.plugin.setGarminApiKeyName(name);
                      }),
                  )
                : setting.addText((text) => {
                    text
                      .setPlaceholder("Paste your API key")
                      .setValue(this.plugin.getGarminApiKey() ?? "")
                      .onChange((value) => {
                        void this.plugin.setGarminApiKey(value);
                      });
                    text.inputEl.type = "password";
                  }),
          },
        ],
      },
      {
        heading: "Strava",
        visible: usesSource("strava"),
        rows: [
          {
            name: "Strava client ID",
            desc: linkedDesc(
              "Enter your Strava API client ID (",
              "instructions",
              SYNC_CONFIGURATION_URL,
              ")",
            ),
            render: (setting) =>
              setting.addText((text) =>
                text
                  .setPlaceholder("Enter client ID")
                  .setValue(settings.authentication.stravaClientId)
                  .onChange((value) => {
                    settings.authentication.stravaClientId = value;
                    save();
                  }),
              ),
          },
          {
            name: "Strava client secret",
            desc: linkedDesc(
              "Choose the secret holding your Strava API client secret, or create one (",
              "instructions",
              SYNC_CONFIGURATION_URL,
              ")",
            ),
            render: (setting) =>
              requireApiVersion("1.11.4")
                ? setting.addComponent((el) =>
                    new SecretComponent(this.app, el)
                      .setValue(
                        settings.authentication.stravaClientSecretName ?? "",
                      )
                      .onChange((name) => {
                        void this.plugin.setStravaClientSecretName(name);
                      }),
                  )
                : setting.addText((text) => {
                    text
                      .setPlaceholder("Enter client secret")
                      .setValue(settings.authentication.stravaClientSecret)
                      .onChange((value) => {
                        settings.authentication.stravaClientSecret = value;
                        save();
                      });
                    text.inputEl.type = "password";
                  }),
          },
          {
            name: "Authenticate with Strava",
            desc: "Click to start the OAuth flow with Strava",
            render: (setting) => {
              // Shows the button as Strava's "Connect with Strava" image
              setting.setClass("physical-activity-importer-strava-connect");
              if (settings.authentication.stravaAccessToken) {
                setting.controlEl.createDiv({ text: "✅" });
              }
              setting.addButton((button) => {
                button.onClick(() => {
                  if (
                    !settings.authentication.stravaClientId ||
                    !settings.authentication.stravaClientSecret
                  ) {
                    new Notice(
                      "🛑 Please enter your Strava client ID and client secret first.",
                      8000,
                    );
                    return;
                  }

                  window.open(
                    this.plugin.stravaApi.buildAuthorizeUrl(),
                    "_blank",
                  );
                });
              });
            },
          },
        ],
      },
      {
        heading: "Sync",
        rows: [
          {
            name: "Folder",
            desc: "Enter the folder where the data will be stored. {{id}}, {{name}} and {{start_date}} can be used in the folder name",
            render: (setting) =>
              setting.addText((text) =>
                text
                  .setPlaceholder("Enter the folder")
                  .setValue(settings.sync.folder)
                  .onChange((value) => {
                    settings.sync.folder = value;
                    save();
                  }),
              ),
          },
          {
            name: "Folder date format",
            desc: linkedDesc(
              "If date is used as part of folder name, specify the format date for use. Format ",
              "reference",
              LUXON_FORMAT_URL,
              ".",
            ),
            render: (setting) =>
              setting.addText((text) =>
                text
                  .setPlaceholder(DEFAULT_SETTINGS.sync.folderDateFormat)
                  .setValue(settings.sync.folderDateFormat)
                  .onChange((value) => {
                    settings.sync.folderDateFormat = value;
                    save();
                  }),
              ),
          },
          {
            name: "Filename",
            desc: "Enter the filename where the data will be stored. {{id}}, {{name}} and {{start_date}} can be used in the filename",
            render: (setting) =>
              setting.addText((text) =>
                text
                  .setPlaceholder("Enter the filename")
                  .setValue(settings.sync.filename)
                  .onChange((value) => {
                    settings.sync.filename = value;
                    save();
                  }),
              ),
          },
          {
            name: "Filename date format",
            desc: linkedDesc(
              "If date is used as part of file name, specify the format date for use. Format ",
              "reference",
              LUXON_FORMAT_URL,
              ".",
            ),
            render: (setting) =>
              setting.addText((text) =>
                text
                  .setPlaceholder(DEFAULT_SETTINGS.sync.filenameDateFormat)
                  .setValue(settings.sync.filenameDateFormat)
                  .onChange((value) => {
                    settings.sync.filenameDateFormat = value;
                    save();
                  }),
              ),
          },
          {
            name: "Re-import activities",
            desc: "Fetch activities from a date you choose again, from the source above, and create notes for any that are missing. Existing notes aren't changed.",
            render: (setting) =>
              setting.addButton((button) =>
                button
                  .setButtonText("Re-import…")
                  .onClick(() => this.plugin.openReimportModal()),
              ),
          },
          {
            name: "Import Strava bulk export",
            desc: linkedDesc(
              "Import activities.csv from a Strava bulk export CSV file following ",
              "these instructions",
              "https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export#h_01GG58HC4F1BGQ9PQZZVANN6WF",
              " to generate the export.",
            ),
            render: (setting) =>
              setting.addButton((button) =>
                button
                  .setButtonText("Import CSV")
                  .setCta()
                  .onClick(() => void this.importCSV()),
              ),
          },
          {
            name: "Import FIT files",
            desc: "Import activity files exported from Garmin, COROS, Wahoo, Polar, Suunto and other devices. Select one or more .fit files.",
            render: (setting) =>
              setting.addButton((button) =>
                button
                  .setButtonText("Import FIT")
                  .onClick(() => void this.plugin.importActivitiesFromFIT()),
              ),
          },
        ],
      },
      {
        heading: "Calories",
        rows: [
          {
            name: "Sex",
            desc: "Garmin and FIT imports can estimate calories from second-by-second heart rate (or power, for rides with a power meter) and your details here, often closer than the device's figure. Estimates are made once sex, birth year and weight are set, and calories, estimated_calories, active_calories (the part above resting burn) and calories_method are then added to the properties.",
            render: (setting) =>
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOption("", "Not set")
                  .addOption("male", "Male")
                  .addOption("female", "Female")
                  .setValue(settings.calories.sex ?? "")
                  .onChange((value) => {
                    settings.calories.sex =
                      value === "male" || value === "female"
                        ? value
                        : undefined;
                    save();
                  }),
              ),
          },
          {
            name: "Birth year",
            desc: "For your age at each activity.",
            render: (setting) =>
              setting.addText((text) => {
                text
                  .setPlaceholder("1990")
                  .setValue(settings.calories.birthYear?.toString() ?? "")
                  .onChange((value) => {
                    settings.calories.birthYear = positiveNumber(value);
                    save();
                  });
                text.inputEl.type = "number";
              }),
          },
          {
            name: "Weight",
            render: (setting) =>
              setting
                .addText((text) => {
                  text
                    .setPlaceholder("70")
                    .setValue(settings.calories.weight?.toString() ?? "")
                    .onChange((value) => {
                      settings.calories.weight = positiveNumber(value);
                      save();
                    });
                  text.inputEl.type = "number";
                })
                .addDropdown((dropdown) =>
                  dropdown
                    .addOption("kg", "Kilograms")
                    .addOption("lb", "Pounds")
                    .setValue(settings.calories.weightUnit)
                    .onChange((value) => {
                      settings.calories.weightUnit = value as WeightUnit;
                      save();
                    }),
                ),
          },
          {
            name: "VO2 max",
            desc: "Optional, in ml/kg/min, such as the estimate your watch shows. Makes heart rate estimates more accurate.",
            render: (setting) =>
              setting.addText((text) => {
                text
                  .setPlaceholder("Not set")
                  .setValue(settings.calories.vo2max?.toString() ?? "")
                  .onChange((value) => {
                    settings.calories.vo2max = positiveNumber(value);
                    save();
                  });
                text.inputEl.type = "number";
              }),
          },
        ],
      },
      {
        heading: "Activity",
        rows: [
          {
            name: "Properties / front matter",
            desc: "Enter the metadata to be used in your note separated by commas.",
            render: (setting) =>
              setting.addTextArea((text) => {
                text
                  .setPlaceholder("Enter the metadata")
                  .setValue(settings.activity.frontMatterProperties.join(","))
                  .onChange((value) => {
                    settings.activity.frontMatterProperties = value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(
                        (v, i, a) =>
                          VALID_FRONT_MATTER_PROPERTIES.includes(v) &&
                          a.indexOf(v) === i,
                      );
                    save();
                  });
                text.inputEl.setAttr("rows", 4);
                text.inputEl.setAttr("cols", 30);
              }),
          },
          {
            name: "Activity date format",
            desc: linkedDesc(
              "If date is used as part of activity content, specify the format date for use. Format ",
              "reference",
              LUXON_FORMAT_URL,
              ".",
            ),
            render: (setting) =>
              setting.addText((text) =>
                text
                  .setPlaceholder(DEFAULT_SETTINGS.activity.contentDateFormat)
                  .setValue(settings.activity.contentDateFormat)
                  .onChange((value) => {
                    settings.activity.contentDateFormat = value;
                    save();
                  }),
              ),
          },
          {
            name: "Distance units",
            desc: "For distances and paces in activity content, such as the laps table.",
            render: (setting) =>
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOption("km", "Kilometres")
                  .addOption("mi", "Miles")
                  .setValue(settings.activity.distanceUnit)
                  .onChange((value) => {
                    settings.activity.distanceUnit = value as DistanceUnit;
                    save();
                  }),
              ),
          },
          {
            name: "Activity template",
            desc: createFragment((fragment) => {
              fragment.append(
                "Enter template to render activities with.",
                fragment.createEl("br"),
                fragment.createEl("br"),
                fragment.createEl("a", {
                  text: "More information",
                  href: "https://github.com/BenRuns/physical-activity-importer?tab=readme-ov-file#content",
                }),
              );
            }),
            render: (setting) =>
              setting
                .addExtraButton((button) => {
                  // Add a button to reset template
                  button
                    .setIcon("reset")
                    .setTooltip("Reset template")
                    .onClick(() => {
                      settings.activity.template =
                        DEFAULT_SETTINGS.activity.template;
                      save();
                      this.refresh();
                      new Notice("Template reset");
                    });
                })
                .addTextArea((text) => {
                  text
                    .setPlaceholder("Enter the template")
                    .setValue(settings.activity.template)
                    .onChange((value) => {
                      settings.activity.template = value
                        ? value
                        : DEFAULT_SETTINGS.activity.template;
                      save();
                    });
                  text.inputEl.setAttr("rows", 15);
                  text.inputEl.setAttr("cols", 50);
                }),
          },
        ],
      },
      {
        // Strava's brand guidelines ask for this wherever Strava data is used
        visible: usesSource("strava"),
        rows: [
          {
            name: "Powered by Strava",
            searchable: false,
            render: (setting) => {
              setting.settingEl.empty();
              setting.settingEl.addClass("strava-powered-by");
            },
          },
        ],
      },
    ];
  }
}
