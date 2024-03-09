export function createMyResizeObserver() {
  return class MyResizeObserver {
    public ob: ResizeObserver;

    constructor(target: Element, callback: ResizeObserverEntryCallback) {
      this.ob = new ResizeObserver((entries, observer) => {
        entries.forEach((entry) => callback(entry, observer));
      });
      this.ob.observe(target);
    }

    disconnect() {
      this.ob.disconnect();
    }

    unobserver(target: Element) {
      this.ob.unobserve(target);
    }
  };
}

export function createMyMutationObserver() {
  return class MyMutationObserver {
    public ob: MutationObserver;
    public callback: MutationCallback;

    constructor(callback: MutationRecordCallback) {
      this.callback = (mutationList, observer) => {
        mutationList.forEach((mutation) => callback(mutation, observer));
      };
      this.ob = new MutationObserver(this.callback);
    }

    observe(target: Node, options?: MutationObserverInit) {
      this.ob.observe(target, options);
    }

    disconnect() {
      const mutations = this.ob.takeRecords();
      if (mutations) {
        this.callback(mutations, this.ob);
      }
      this.ob.disconnect();
    }
  };
}

export function createMutationObserverSet() {
  return class MutationObserverSet {
    public obs: MyMutationObserver[];

    constructor() {
      this.obs = [];
    }

    observe(target: Node, type: MyMutationRecordType, callback: MutationRecordCallback) {
      const MyMutationObserver = createMyMutationObserver();
      const ob = new MyMutationObserver(callback);
      const optionsMap: MutationObserverInitMap = {
        childList: { childList: true, subtree: true },
        class: { attributes: true, attributeFilter: ['class'] },
        all: { attributes: true, attributeFilter: ['class'], childList: true, subtree: true },
      };
      ob.observe(target, optionsMap[type]);
      this.obs.push(ob);
    }

    disconnect() {
      this.obs.forEach((ob) => ob.disconnect());
    }
  };
}
