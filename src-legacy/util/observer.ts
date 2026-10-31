/**
 * MyResizeObserver 类的工厂函数
 *
 * @returns MyResizeObserver 类
 */
export function createMyResizeObserver() {
  return class MyResizeObserver {
    /**
     * 内部包装的 ResizeObserver
     */
    public ob: ResizeObserver;

    constructor(target: Element, callback: ResizeObserverEntryCallback) {
      this.ob = new ResizeObserver((entries, observer) => {
        entries.forEach(entry => callback(entry, observer));
      });
      this.ob.observe(target);
    }

    /**
     * 监听指定元素
     *
     * @param target
     */
    observe(target: Element) {
      this.ob.observe(target);
    }

    /**
     * 取消链接
     */
    disconnect() {
      this.ob.disconnect();
    }

    /**
     * 取消监听对应的元素
     *
     * @param target
     */
    unobserver(target: Element) {
      this.ob.unobserve(target);
    }
  };
}

/**
 * MyMutationObserver 类的工厂函数
 *
 * @returns MyMutationObserver 类
 */
export function createMyMutationObserver() {
  return class MyMutationObserver {
    /**
     * 内部包装的 MutationObserver
     */
    public ob: MutationObserver;

    /**
     * 内部包装的 MutationObserver 触发的回调
     */
    public callback: MutationCallback;

    constructor(callback: MutationRecordCallback) {
      this.callback = (mutationList, observer) => {
        mutationList.forEach(mutation => callback(mutation, observer));
      };
      this.ob = new MutationObserver(this.callback);
    }

    /**
     * 根据配置监听指定元素
     *
     * @param target
     * @param options
     */
    observe(target: Node, options?: MutationObserverInit) {
      this.ob.observe(target, options);
    }

    /**
     * 取消监听
     */
    disconnect() {
      const mutations = this.ob.takeRecords();
      if (mutations) {
        this.callback(mutations, this.ob);
      }
      this.ob.disconnect();
    }
  };
}

/**
 * MutationObserverSet 类的工厂函数
 *
 * @returns MutationObserverSet 类
 */
export function createMutationObserverSet() {
  const MyMutationObserver = createMyMutationObserver();
  return class MutationObserverSet {
    /**
     * 内部包装的 MyMutationObserver 集合
     */
    public obs: InstanceType<typeof MyMutationObserver>[];

    constructor() {
      this.obs = [];
    }

    /**
     * 按类型监听指定的元素，并声明回调
     *
     * @param target
     * @param type
     * @param callback
     */
    observe(target: Node, type: MyMutationRecordType, callback: MutationRecordCallback) {
      const ob = new MyMutationObserver(callback);
      const optionsMap: MutationObserverInitMap = {
        childList: { childList: true, subtree: true },
        class: { attributes: true, attributeFilter: ['class'] },
        all: { attributes: true, attributeFilter: ['class'], childList: true, subtree: true },
      };
      ob.observe(target, optionsMap[type]);
      this.obs.push(ob);
    }

    /**
     * 取消监听
     */
    disconnect() {
      this.obs.forEach(ob => ob.disconnect());
    }
  };
}
