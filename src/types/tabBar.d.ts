type Direction = 'Left' | 'Right';

interface ResizeObserverEntryCallback {
  (entries: ResizeObserverEntry, observer: ResizeObserver): void;
}

interface MutationRecordCallback {
  (mutation: MutationRecord, observer: MutationObserver): void;
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
