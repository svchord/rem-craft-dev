import { createMutationObserverSet, createMyResizeObserver } from '@/util/observer';
import { UI, Layout } from '@/const/dom';

/**
 * Tab 类的工厂函数
 *
 * @returns Tab 类
 */
function createTab() {
  enum CSS_VAR {
    paddingLeft = '--rc-tab-padding-left',
    paddingRight = '--rc-tab-padding-right',
    radiusLeft = '--rc-tab-radius-left',
    radiusRight = '--rc-tab-radius-right',
  }
  return class Tab {
    public wnds: HTMLElement[] | [];

    constructor() {
      this.wnds = [];
      this.init();
    }

    init() {
      requestAnimationFrame(() => {
        this.wnds = this.getWnds();
        this.wnds.forEach(wnd => wnd.classList.add('rc-wnd'));
        this.setMargin();
        this.setRadius();
      });
    }

    clear() {
      const center = Layout().center();
      if (center) {
        center.style.removeProperty(CSS_VAR.radiusLeft);
        center.style.removeProperty(CSS_VAR.radiusRight);
      }
      this.wnds.forEach(wnd => {
        wnd.classList.remove('rc-wnd');
        wnd.style.removeProperty(CSS_VAR.paddingLeft);
        wnd.style.removeProperty(CSS_VAR.paddingRight);
        wnd.style.removeProperty(CSS_VAR.radiusLeft);
        wnd.style.removeProperty(CSS_VAR.radiusRight);
      });
    }

    reset() {
      this.clear();
      this.init();
    }

    getWnds(): HTMLElement[] | [] {
      const center = Layout().center();
      const topBarRect = UI().topBar()?.getBoundingClientRect();
      if (!center || !topBarRect) {
        return [];
      }
      const wnds = [...center.querySelectorAll('[data-type="wnd"]')] as HTMLElement[];
      return wnds.filter(wnd => wnd.getBoundingClientRect().top < topBarRect.bottom);
    }

    setMargin() {
      if (!this.wnds.length) {
        return;
      }
      const dragRect = UI().drag()?.getBoundingClientRect();
      if (!dragRect) {
        return;
      }
      for (const wnd of this.wnds) {
        const wndRect = wnd.getBoundingClientRect();
        const left = Math.max(wndRect.left, dragRect.left) - wndRect.left;
        const right = Math.max(wndRect.right, dragRect.right) - dragRect.right;
        wnd.style.setProperty(CSS_VAR.paddingLeft, `${left}px`);
        wnd.style.setProperty(CSS_VAR.paddingRight, `${right}px`);
      }
    }

    setRadius() {
      this.wnds.forEach(wnd => this.setElementRadius(wnd));
      const center = Layout().center();
      const empty = Layout().empty();
      if (center && empty) {
        this.setElementRadius(center);
      }
    }

    setElementRadius(elment: HTMLElement) {
      const parentRect = Layout().center()?.parentElement?.getBoundingClientRect();
      if (!parentRect) {
        return;
      }
      const rect = elment.getBoundingClientRect();
      function radius(intervarl: number) {
        return Math.abs(intervarl) < 1 ? 'var(--b3-border-radius-b)' : '0';
      }
      elment.style.setProperty(CSS_VAR.radiusLeft, radius(rect.left - parentRect.left));
      elment.style.setProperty(CSS_VAR.radiusRight, radius(rect.right - parentRect.right));
    }
  };
}

/**
 * TabObserver 类的工厂函数
 *
 * @returns TabObserver 类
 */
export function createTabObserver() {
  return class TabObserver {
    public tab;

    /**
     * 编辑区域尺寸监听器
     *
     * @type {(MyResizeObserver | undefined)}
     */
    public centerOb: MyResizeObserver | undefined;

    /**
     * 当前Tab相关Dom的Mutation监听器集合
     *
     * @type {(MutationObserverSet | undefined)}
     */
    public mutaionObSet: MutationObserverSet | undefined;

    constructor() {
      const Tab = createTab();
      this.tab = new Tab();
      this.observe();
    }

    /**
     * 监听相关dom元素，并修改tab状态
     */
    observe() {
      const topBar = UI().topBar();
      const center = Layout().center();
      if (!topBar || !center) {
        return;
      }
      // 编辑区域的尺寸监听
      const MyResizeObserver = createMyResizeObserver();
      this.centerOb = new MyResizeObserver(center, () => {
        this.tab.setMargin();
        this.tab.setRadius();
      });
      // 相关DOM变动监听
      const MutationObserverSet = createMutationObserverSet();
      this.mutaionObSet = new MutationObserverSet();
      // 顶栏元素变更
      this.mutaionObSet?.observe(topBar, 'all', mutation => {
        const { target } = mutation;
        if (target instanceof HTMLElement === false) {
          return;
        }
        if (!target.classList.contains('toolbar__item')) {
          return;
        }
        this.tab.setMargin();
      });
      // 分屏 || 空白页 监听判断
      this.mutaionObSet?.observe(center, 'childList', mutation => {
        const { addedNodes, removedNodes } = mutation;
        if (!addedNodes.length && !removedNodes.length) {
          return;
        }
        const node = addedNodes[0] ?? removedNodes[0];
        if (node?.nodeType !== Node.ELEMENT_NODE) {
          return;
        }
        if (node instanceof HTMLElement === false) {
          return;
        }
        if (!node.classList.contains('layout__resize') && !node.querySelector('.layout__empty')) {
          return;
        }
        this.tab.reset();
      });
    }

    /**
     * 取消监听
     */
    disconnect() {
      if (this.tab) {
        this.tab.clear();
      }
      this.centerOb?.disconnect();
      this.mutaionObSet?.disconnect();
    }
  };
}
