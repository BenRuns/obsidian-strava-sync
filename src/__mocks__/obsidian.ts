export class Plugin {
  app: unknown;
  manifest: unknown;

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  loadData = jest.fn().mockResolvedValue({});
  saveData = jest.fn().mockResolvedValue({});
  addRibbonIcon = jest.fn();
  addCommand = jest.fn();
  addSettingTab = jest.fn();
  registerObsidianProtocolHandler = jest.fn();
}

export const App = jest.fn().mockImplementation(() => ({
  vault: {
    create: jest.fn(),
    getAbstractFileByPath: jest.fn(),
    createFolder: jest.fn(),
  },
}));

export const TFile = jest.fn();
export const TFolder = jest.fn();
export const Vault = jest.fn().mockImplementation(() => ({
  create: jest.fn(),
  getAbstractFileByPath: jest.fn(),
  createFolder: jest.fn(),
}));

export const Notice = jest.fn();
export const addIcon = jest.fn();
export const normalizePath = jest.fn().mockImplementation((path) => path);
export const requestUrl = jest.fn();
export const requireApiVersion = jest.fn().mockReturnValue(true);

// Records the rows a settings tab adds, so tests can inspect them.
class MockContainerEl {
  settings: Setting[] = [];

  empty() {
    this.settings = [];
  }
}

export class PluginSettingTab {
  app: unknown;
  containerEl = new MockContainerEl();
  update = jest.fn();

  constructor(app: unknown) {
    this.app = app;
  }
}

// Text, text area and button components: keeps the value and handlers
// so tests can trigger them.
class MockComponent {
  value?: string;
  onChangeHandler?: (value: string) => unknown;
  onClickHandler?: () => unknown;
  inputEl = { setAttr: jest.fn() };

  setPlaceholder() {
    return this;
  }

  setValue(value: string) {
    this.value = value;
    return this;
  }

  onChange(handler: (value: string) => unknown) {
    this.onChangeHandler = handler;
    return this;
  }

  onClick(handler: () => unknown) {
    this.onClickHandler = handler;
    return this;
  }

  setButtonText() {
    return this;
  }

  setCta() {
    return this;
  }

  setIcon() {
    return this;
  }

  setTooltip() {
    return this;
  }
}

export class Setting {
  name?: string;
  desc?: unknown;
  heading = false;
  components: MockComponent[] = [];
  controlEl = { createDiv: jest.fn() };
  settingEl = { empty: jest.fn(), addClass: jest.fn() };

  constructor(containerEl?: MockContainerEl) {
    containerEl?.settings.push(this);
  }

  setName(name: string) {
    this.name = name;
    return this;
  }

  setDesc(desc: unknown) {
    this.desc = desc;
    return this;
  }

  setHeading() {
    this.heading = true;
    return this;
  }

  private addComponent(callback: (component: MockComponent) => unknown) {
    const component = new MockComponent();
    this.components.push(component);
    callback(component);
    return this;
  }

  addText(callback: (component: MockComponent) => unknown) {
    return this.addComponent(callback);
  }

  addTextArea(callback: (component: MockComponent) => unknown) {
    return this.addComponent(callback);
  }

  addButton(callback: (component: MockComponent) => unknown) {
    return this.addComponent(callback);
  }

  addExtraButton(callback: (component: MockComponent) => unknown) {
    return this.addComponent(callback);
  }
}
