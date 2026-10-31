/**
 * ResizeObserverEntry 触发的回调类型
 */
interface ResizeObserverEntryCallback {
  (entries: ResizeObserverEntry, observer: ResizeObserver): void;
}

/**
 * MutationRecord 触发的回调类型
 */
interface MutationRecordCallback {
  (mutation: MutationRecord, observer: MutationObserver): void;
}

/**
 * 简化后的 MutationRecordType
 */
type MyMutationRecordType = 'childList' | 'class' | 'all';

/**
 * MyMutationRecordType 和 MutationObserverInit 的索引类型
 */
type MutationObserverInitMap = {
  [K in MyMutationRecordType]: MutationObserverInit;
};
