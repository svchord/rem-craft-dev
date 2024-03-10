/**
 * ResizeObserverEntry 触发的回调类型
 */
interface ResizeObserverEntryCallback {
  (entries: ResizeObserverEntry, observer: ResizeObserver): void;
}

/**
 * 包装后的 ResizeObserver
 */
interface MyResizeObserver {
  /**
   * 内部包装的 ResizeObserver
   */
  ob: ResizeObserver;

  /**
   * 监听指定元素
   *
   * @param target
   */
  observe(target: Element): void;

  /**
   * 取消链接
   */
  disconnect(): void;

  /**
   * 取消监听对应的元素
   *
   * @param target
   */
  unobserver(target: Element): void;
}

/**
 * MyResizeObserver 的构造函数类型
 */
type MyResizeObserverConstructor = new (
  target: Element,
  callback: ResizeObserverEntryCallback
) => MyResizeObserver;

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

/**
 * 包装后的 MutationObserver
 */
interface MyMutationObserver {
  /**
   * 内部包装的 MutationObserver
   */
  ob: MutationObserver;

  /**
   * 内部包装的 MutationObserver 触发的回调
   */
  callback: MutationCallback;

  /**
   * 根据配置监听指定元素
   *
   * @param target
   * @param options
   */
  observe(target: Node, options?: MutationObserverInit): void;

  /**
   * 取消监听
   */
  disconnect(): void;
}

/**
 * MyMutationObserver 的构造函数类型
 */
type MyMutationObserverConstructor = new (callback: MutationRecordCallback) => MyMutationObserver;

interface MutationObserverSet {
  /**
   * 内部包装的 MyMutationObserver 集合
   */
  obs: MyMutationObserver[];

  /**
   * 按类型监听指定的元素，并声明回调
   *
   * @param target
   * @param type
   * @param callback
   */
  observe(target: Node, type: MyMutationRecordType, callback: MutationRecordCallback): void;

  /**
   * 取消监听
   */
  disconnect(): void;
}

/**
 * MyMutationObserverSet 的构造函数类型
 */
type MyMutationObserverSetConstructor = new () => MyMutationObserverSet;
