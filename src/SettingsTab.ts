import {
  type App,
  Notice,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
  requireApiVersion,
} from "obsidian";
import { DEFAULT_SETTINGS, VALID_FRONT_MATTER_PROPERTIES } from "./Settings";
import type StravaSync from "./StravaSync";

const LUXON_FORMAT_URL =
  "https://moment.github.io/luxon/#/formatting?id=table-of-tokens";
const SYNC_CONFIGURATION_URL =
  "https://github.com/watsonbox/obsidian-strava-sync?tab=readme-ov-file#sync-configuration";

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
  plugin: StravaSync;

  constructor(app: App, plugin: StravaSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Obsidian 1.13+ renders these, and skips display().
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map(({ heading, rows }) => ({
      type: "group" as const,
      heading,
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

  private renderRows(): void {
    const { containerEl } = this;

    containerEl.empty();

    for (const { heading, rows } of this.sections()) {
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

    return [
      {
        heading: "Authentication",
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
              "Enter your Strava API client secret (",
              "instructions",
              SYNC_CONFIGURATION_URL,
              ")",
            ),
            render: (setting) =>
              setting.addText((text) =>
                text
                  .setPlaceholder("Enter client secret")
                  .setValue(settings.authentication.stravaClientSecret)
                  .onChange((value) => {
                    settings.authentication.stravaClientSecret = value;
                    save();
                  }),
              ),
          },
          {
            name: "Authenticate with Strava",
            desc: "Click to start the OAuth flow with Strava",
            render: (setting) => {
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
            name: "Activity template",
            desc: createFragment((fragment) => {
              fragment.append(
                "Enter template to render activities with.",
                fragment.createEl("br"),
                fragment.createEl("br"),
                fragment.createEl("a", {
                  text: "More information",
                  href: "https://github.com/watsonbox/obsidian-strava-sync?tab=readme-ov-file#content",
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
