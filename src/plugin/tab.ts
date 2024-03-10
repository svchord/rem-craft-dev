import { createMutationObserverSet, createMyResizeObserver } from '@/util/observer';
import { UI, Layout } from '@/const/dom';

/**
 * Tab 类的工厂函数
 *
 * @returns Tab 类
 */
function createTab(): TabConstructor {
  return class T implements Tab {
    /**
     * 当前方向
     *
     * @type {Direction}
     */
    public direction: Direction;

    /**
     * 当前 Tab 的编辑窗口
     *
     * @type {(HTMLElement | null)}
     */
    public wnd: HTMLElement | null;

    /**
     * 当前 Tab 的最大 margin
     *
     * @type {number}
     */
    public maxMargin: number;

    constructor(direction: Direction) {
      this.direction = direction;
      this.maxMargin = this.calMaxMargin();
      this.wnd = this.getWnd(Layout().center());
      this.init();
    }

    /**
     * 初始化选择器和样式
     */
    init() {
      this.wnd?.classList.add(this.wndClassName);
      const width = this.calLayoutDockWidth();
      this.setMargin(width);
      this.setRadius(width);
    }

    /**
     * 清空选择器和样式
     */
    clear() {
      Layout().center()?.classList.remove(this.radiusClassName);
      this.wnd?.style.removeProperty(this.cssVar);
      this.wnd?.classList.remove(this.wndClassName);
      this.wnd?.classList.remove(this.radiusClassName);
    }

    /**
     * 重置选择器和样式/
     */
    reset() {
      this.clear();
      this.wnd = this.getWnd(Layout().center());
      this.init();
    }

    /**
     * 递归获取目标编辑窗口
     *
     * @param parent 父元素
     * @returns 目标窗口
     */
    getWnd(parent: HTMLElement | null): HTMLElement | null {
      if (!parent) {
        return null;
      }
      const children = [...parent.children] as HTMLElement[];
      const wnd = children.find(e => e.dataset.type === 'wnd');

      // 定位到编辑窗口
      if (wnd) {
        const tabBar = wnd.children[0] as HTMLElement;
        // 判断是否显示页签栏
        if (!tabBar.classList.contains('fn__none')) {
          return wnd;
        } else {
          return null;
        }
      }
      // 未定位到，即分屏情况，递归查询
      const isLRSplitScreen = children.find(e => e.classList.contains('layout__resize--lr'));
      if (isLRSplitScreen && this.direction === 'Right') {
        // 左右分屏 且 定位方向为右上角
        return this.getWnd(children.at(-1) as HTMLElement);
      } else {
        // 上下分屏 或 左右分屏，定位方向为左上角
        return this.getWnd(children[0]);
      }
    }

    /**
     * 返回根据顶栏按钮计算的margin最大值
     *
     * @returns margin最大值
     */
    calMaxMargin(): number {
      let margin = 0;
      const topBar = UI().topBar();
      if (!topBar) {
        return margin;
      }
      const topBarStyle = window.getComputedStyle(topBar);
      const children = [...topBar.children] as HTMLElement[];
      for (let i = 0; i < children.length; i++) {
        const btn = children[i];
        if (!btn || btn.classList.contains('fn__none')) {
          continue;
        }
        if (btn.id === 'drag') {
          if (this.direction === 'Left') {
            break;
          } else {
            margin = 0;
            continue;
          }
        }
        const btnStyle = window.getComputedStyle(btn);
        margin +=
          parseInt(btnStyle.marginLeft) +
          btn.offsetWidth +
          parseInt(btnStyle.marginRight) +
          parseInt(topBarStyle.gap);
      }
      margin += parseInt(topBarStyle[`padding${this.direction}`]);
      const dockWidth = UI().dock(this.direction)?.offsetWidth;
      if (this.isDockExist && dockWidth) {
        margin -= dockWidth;
      }
      return margin;
    }

    /**
     * 重新计算margin最大值
     */
    recalMaxMargin() {
      this.maxMargin = this.calMaxMargin();
    }

    /**
     * 返回计算得到的dock栏可视宽度
     *
     * @returns dock栏可视宽度
     */
    calLayoutDockWidth(): number {
      const layoutDock = Layout().dock(this.direction) as HTMLElement;
      if (!layoutDock) {
        return 0;
      }
      let width = layoutDock.offsetWidth;
      // 悬浮 dock 宽度 = 0
      if (layoutDock.classList.contains('layout--float')) {
        width = 0;
      }
      return width;
    }

    /**
     * 根据传参 value
     * 或者 margin 最大值和 dock 栏可视宽度
     * 设置当前 margin
     *
     * @param value
     */
    setMargin(value?: number) {
      if (!this.wnd) {
        return;
      }
      const width = value ?? this.calLayoutDockWidth();
      let margin = Math.max(this.maxMargin, width) - width;
      if (width < 0) {
        margin = 0;
      }
      this.wnd.style.setProperty(this.cssVar, `${margin}px`);
    }

    /**
     * 根据传参 value
     * 或者 dock 栏可视宽度
     * 设置当前编辑窗口圆角
     *
     * @param width
     */
    setRadius(value?: number) {
      let element;
      if (this.wnd) {
        element = this.wnd;
      } else {
        element = Layout().center();
      }
      if (!element) {
        return;
      }
      const width = value ?? this.calLayoutDockWidth();
      if (width === 0) {
        element.classList.add(this.radiusClassName);
      } else {
        element.classList.remove(this.radiusClassName);
      }
    }

    /**
     * 当前方向的 dock 入口栏是否显示
     *
     * @readonly
     */
    public get isDockExist() {
      const dock = UI().dock(this.direction);
      return dock && !dock.classList.contains('fn__none');
    }

    /**
     * 当前方向的编辑窗口选择器
     *
     * @readonly
     */
    public get wndClassName() {
      return `rc-wnd-${this.direction.toLocaleLowerCase()}`;
    }

    /**
     * 当前方向的编辑窗口圆角选择器
     *
     * @readonly
     */
    public get radiusClassName() {
      return `rc-tab-radius-${this.direction.toLocaleLowerCase()}`;
    }

    /**
     * 当前方向的css变量名
     *
     * @readonly
     */
    public get cssVar() {
      return `--rc-tab-margin-${this.direction.toLocaleLowerCase()}`;
    }
  };
}

/**
 * TabObserver 类的工厂函数
 *
 * @returns TabObserver 类
 */
export function createTabObserver(): TabObserverConstructor {
  return class TO implements TabObserver {
    /**
     * 当前方向
     *
     * @type {Direction}
     */
    public direction: Direction;

    /**
     * 当前方向的 Tab
     *
     * @type {Tab}
     */
    public tab: Tab;

    /**
     * 当前方向的 dock 栏尺寸监听器
     *
     * @type {(MyResizeObserver | undefined)}
     */
    public dockOb: MyResizeObserver | undefined;

    /**
     * 当前 Tab 相关 Dom 的监听器集合
     *
     * @type {(MutationObserverSet | undefined)}
     */
    public mutaionObSet: MutationObserverSet | undefined;

    constructor(direction: Direction) {
      this.direction = direction;
      const Tab = createTab();
      this.tab = new Tab(direction);
      this.observe();
    }

    /**
     * 监听相关dom元素，并修改tab状态
     */
    observe() {
      const layoutDock = Layout().dock(this.direction);
      const UIDock = UI().dock(this.direction);
      const topBar = UI().topBar();
      const center = Layout().center();
      if (!layoutDock || !topBar || !UIDock || !center) {
        return;
      }
      const MyResizeObserver = createMyResizeObserver();
      // 边栏未悬浮的尺寸监听
      this.dockOb = new MyResizeObserver(layoutDock, entry => {
        if (entry.target.classList.contains('layout--float')) {
          return;
        }
        this.tab.setRadius(entry.contentBoxSize[0].inlineSize);
        this.tab.setMargin(entry.contentBoxSize[0].inlineSize);
      });
      const MutationObserverSet = createMutationObserverSet();
      // 相关DOM变动监听
      this.mutaionObSet = new MutationObserverSet();

      // 顶栏按钮数量变化
      this.mutaionObSet?.observe(topBar, 'all', mutation => {
        const { target } = mutation;
        if (target instanceof HTMLElement === false) {
          return;
        }
        if (!target.classList.contains('toolbar__item')) {
          return;
        }
        this.tab.recalMaxMargin();
        this.tab.setMargin();
      });
      // 悬浮dock
      this.mutaionObSet?.observe(layoutDock, 'class', () => {
        this.tab.setRadius();
        this.tab.setMargin();
      });
      // dock 入口隐藏
      this.mutaionObSet?.observe(UIDock, 'class', () => {
        this.tab.recalMaxMargin();
        this.tab.setMargin();
      });
      // 编辑区域监听
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
        // 分屏 || 空白页 监听判断
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
      this.dockOb?.disconnect();
      this.mutaionObSet?.disconnect();
    }
  };
}
