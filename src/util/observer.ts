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
