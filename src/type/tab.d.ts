type Direction = 'Left' | 'Right';

interface Tab {
  direction: Direction;
  wnd: HTMLElement | null;
  maxMargin: number;

  getWnd(parent: Element | null): HTMLElement | null;
  setWnd(): void;
  clearWnd(): void;
  resetWnd(): void;
  calMaxMargin(): number;
  recalMaxMargin(): void;
  calLayoutDockWidth(): number;
  setMargin(value?: number);
  setRadius(value?: number);

  readonly isDockExist: boolean | null;
  readonly wndClassName: string;
  readonly radiusClassName: string;
  readonly cssVar: string;
}

interface TabObserver {
  tab: Tab;
  direction: Direction;
  dockOb: MyResizeObserver | undefined;
  mutaionObSet: MutationObserverSet | undefined;
  observe(): void;
  disconnect(): void;
}

interface Window {
  destroyTheme: () => void;
  siyuan: {
    notebooks: any;
    menus: any;
    dialogs: any;
    blockPanels: any;
    storage: any;
    user: any;
    ws: any;
    languages: any;
    config: any;
  };
}
