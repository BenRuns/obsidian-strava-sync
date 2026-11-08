import { type App, Modal, Notice, Setting } from "obsidian";

const DEFAULT_DAYS_BACK = 30;

// A date as YYYY-MM-DD, in local time.
const isoDate = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

// Asks for a date to re-import activities from. Existing notes are skipped,
// so only missing ones are created.
export class ReimportModal extends Modal {
  private sourceName: string;
  private onSubmit: (since: number) => void;

  // `onSubmit` gets the date as seconds since the epoch, just before local
  // midnight, so activities that day are included.
  constructor(app: App, sourceName: string, onSubmit: (since: number) => void) {
    super(app);
    this.sourceName = sourceName;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    let date = isoDate(
      new Date(Date.now() - DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000),
    );

    this.titleEl.setText(`Re-import activities from ${this.sourceName}`);
    contentEl.createEl("p", {
      text: "Activities from this date on are fetched again, and notes are created for any that are missing. Existing notes aren't changed. Up to 500 activities from Garmin, or 90 from Strava, are fetched at a time.",
    });

    new Setting(contentEl).setName("From").addText((text) => {
      text.inputEl.type = "date";
      text.setValue(date).onChange((value) => {
        date = value;
      });
    });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Re-import")
        .setCta()
        .onClick(() => {
          const start = new Date(`${date}T00:00:00`);
          if (!date || Number.isNaN(start.getTime())) {
            new Notice("Choose a date to re-import from.");
            return;
          }

          this.close();
          this.onSubmit(start.getTime() / 1000 - 1);
        }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
