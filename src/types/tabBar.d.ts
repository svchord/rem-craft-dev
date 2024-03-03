type direction = 'Left' | 'Right';

interface ResizeObserverEntryCallback {
  (entries: ResizeObserverEntry, observer: ResizeObserver): void;
}
