import { MutationObserverSet, MyResizeObserver } from '@/util/observer';
import { UI, Layout } from '@/const/dom';

export class TabObserver {
  private tab: Tab;
  private direction: Direction;
  private dockOb: MyResizeObserver | undefined;
  private mutaionObSet: MutationObserverSet | undefined;

  constructor(direction: Direction) {
    this.direction = direction;
    this.tab = new Tab(direction);
    this.observe();
  }

  /**
   * 监听相关dom元素，并修改tab状态
   */
  observe() {
    const layoutDock = Layout.dock(this.direction);
    const UIDock = UI.dock(this.direction);
    const topBar = UI.topBar();
    const center = Layout.center();
    if (!layoutDock || !topBar || !UIDock || !center) {
      return;
    }
    // 边栏未悬浮的尺寸监听
    this.dockOb = new MyResizeObserver(layoutDock, (entry) => {
      if (entry.target.classList.contains('layout--float')) {
        return;
      }
      this.tab.setRadius(entry.contentBoxSize[0].inlineSize);
      this.tab.setMargin(entry.contentBoxSize[0].inlineSize);
    });
    // 相关DOM变动监听
    this.mutaionObSet = new MutationObserverSet();
    // 顶栏按钮数量变化
    this.mutaionObSet.observe(topBar, 'all', (mutation) => {
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
    this.mutaionObSet.observe(layoutDock, 'class', () => {
      this.tab.setRadius();
      this.tab.setMargin();
    });
    // dock 入口隐藏
    this.mutaionObSet.observe(UIDock, 'class', () => {
      this.tab.recalMaxMargin();
      this.tab.setMargin();
    });
    // 编辑区域监听
    this.mutaionObSet.observe(center, 'childList', (mutation) => {
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
      this.tab.resetWnd();
    });
  }

  /**
   * 取消监听
   */
  disconnect() {
    if (this.tab) {
      this.tab.clearWnd();
    }
    this.dockOb?.disconnect();
    this.mutaionObSet?.disconnect();
  }
}

class Tab {
  public direction: Direction;
  public wnd: HTMLElement | null;
  public maxMargin: number;

  constructor(direction: Direction) {
    this.direction = direction;
    this.maxMargin = this.calMaxMargin();
    this.wnd = this.getWnd(Layout.center());
    this.setWnd();
  }

  /**
   * 递归获取目标编辑窗口
   * @param parent 父元素
   * @returns 目标窗口
   */
  getWnd(parent: Element | null): HTMLElement | null {
    if (!parent) {
      return null;
    }
    const children = [...parent.children] as HTMLElement[];
    const wnd = children.find((e) => e.dataset.type === 'wnd');

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
    const isLRSplitScreen = children.find((e) => e.classList.contains('layout__resize--lr'));
    if (isLRSplitScreen && this.direction === 'Right') {
      // 左右分屏 且 定位方向为右上角
      return this.getWnd(children.at(-1) as HTMLElement);
    } else {
      // 上下分屏 或 左右分屏，定位方向为左上角
      return this.getWnd(children[0]);
    }
  }

  /**
   * 设置目标窗口的选择器和样式
   */
  setWnd() {
    if (!this.wnd) {
      return;
    }
    this.wnd.classList.add(this.wndClassName);
    const width = this.calLayoutDockWidth();
    this.setRadius(width);
    this.setMargin(width);
  }

  /**
   * 清空目标窗口的选择器和样式
   */
  clearWnd() {
    if (!this.wnd) {
      return;
    }
    this.wnd.style.removeProperty(this.cssVar);
    this.wnd.classList.remove(this.wndClassName);
    this.wnd.classList.remove(this.radiusClassName);
  }

  /**
   * 重置目标窗口
   */
  resetWnd() {
    this.clearWnd();
    this.wnd = this.getWnd(Layout.center());
    this.setWnd();
  }

  /**
   * 返回根据顶栏按钮计算的margin最大值
   * @returns margin最大值
   */
  calMaxMargin() {
    let margin = 0;
    const topBar = UI.topBar();
    if (!topBar) {
      return margin;
    }
    const topBarStyle = window.getComputedStyle(topBar);
    const children = [...topBar.children] as HTMLElement[];
    for (let i = 0; i < children.length; i++) {
      const btn = children[i];
      if (!btn) {
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
    const dockWidth = UI.dock(this.direction)?.offsetWidth;
    if (this.isDockExist && dockWidth) {
      margin -= dockWidth + 6;
    } else {
      margin -= 6;
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
   * @returns
   */
  calLayoutDockWidth() {
    const layoutDock = Layout.dock(this.direction) as HTMLElement;
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
   * 根据可视宽度设置圆角
   * @param width
   */
  setRadius(value?: number) {
    if (!this.wnd) {
      return;
    }
    const width = value ?? this.calLayoutDockWidth();
    if (width === 0) {
      this.wnd.classList.add(this.radiusClassName);
    } else {
      this.wnd.classList.remove(this.radiusClassName);
    }
  }

  private get isDockExist() {
    const dock = UI.dock(this.direction);
    return dock && !dock.classList.contains('fn__none');
  }

  private get wndClassName() {
    return `rc-wnd-${this.direction.toLocaleLowerCase()}`;
  }

  private get radiusClassName() {
    return `rc-tab-radius-${this.direction.toLocaleLowerCase()}`;
  }

  private get cssVar() {
    return `--rc-tabBar-margin${this.direction}`;
  }
}
