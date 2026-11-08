import { App, Notice } from "obsidian";
import { ReimportModal } from "../ReimportModal";

jest.mock("obsidian");

interface MockSetting {
  name?: string;
  components: {
    value?: string;
    inputEl: { type?: string };
    onChangeHandler?: (value: string) => unknown;
    onClickHandler?: () => unknown;
  }[];
}

describe("ReimportModal", () => {
  let onSubmit: jest.Mock;
  let modal: ReimportModal;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date(2026, 10, 8, 15, 0).getTime());
    onSubmit = jest.fn();
    modal = new ReimportModal(new App(), "Garmin", onSubmit);
    modal.open();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const settings = () =>
    (modal.contentEl as unknown as { settings: MockSetting[] }).settings;
  const dateField = () => settings()[0].components[0];
  const reimportButton = () => settings()[1].components[0];

  it("names the source", () => {
    expect(modal.titleEl.setText).toHaveBeenCalledWith(
      "Re-import activities from Garmin",
    );
  });

  it("starts 30 days back", () => {
    expect(settings()[0].name).toBe("From");
    expect(dateField().inputEl.type).toBe("date");
    expect(dateField().value).toBe("2026-10-09");
  });

  it("re-imports from just before local midnight on the chosen date", () => {
    dateField().onChangeHandler?.("2026-10-01");

    reimportButton().onClickHandler?.();

    expect(onSubmit).toHaveBeenCalledWith(
      new Date(2026, 9, 1).getTime() / 1000 - 1,
    );
    expect(modal.close).toHaveBeenCalled();
  });

  it("asks for a date when there isn't one", () => {
    dateField().onChangeHandler?.("");

    reimportButton().onClickHandler?.();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(modal.close).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith("Choose a date to re-import from.");
  });
});
