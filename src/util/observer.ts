export class MyResizeObserver {
  private ob: ResizeObserver;

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
}

export class MyMutationObserver {
  private ob: MutationObserver;
  private callback: MutationCallback;

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
}

export class MutationObserverSet {
  private obs: MyMutationObserver[];

  constructor() {
    this.obs = [];
  }

  observe(target: Node, type: MyMutationRecordType, callback: MutationRecordCallback) {
    const ob = new MyMutationObserver(callback);
    const optionsMap: MyMutationObserverInitMap = {
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
}
