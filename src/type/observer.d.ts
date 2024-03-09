interface ResizeObserverEntryCallback {
  (entries: ResizeObserverEntry, observer: ResizeObserver): void;
}

interface MutationRecordCallback {
  (mutation: MutationRecord, observer: MutationObserver): void;
}

type MyMutationRecordType = 'childList' | 'class' | 'all';

type MutationObserverInitMap = {
  [K in MyMutationRecordType]: MutationObserverInit;
};

interface MyResizeObserver {
  ob: ResizeObserver;
  disconnect(): void;
  unobserver(target: Element): void;
}

interface MyMutationObserver {
  ob: MutationObserver;
  callback: MutationCallback;
  observe(target: Node, options?: MutationObserverInit): void;
  disconnect(): void;
}

interface MutationObserverSet {
  obs: MyMutationObserver[];
  observe(target: Node, type: MyMutationRecordType, callback: MutationRecordCallback): void;
  disconnect(): void;
}
