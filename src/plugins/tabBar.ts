import { MyMutationObserver, MyResizeObserver } from '@/util/observer';
import { UI, Layout, BtnsWidth } from '@/const/dom';

export class TabBar {
  public direction: Direction;
  public tabBar: HTMLElement | null;
  public maxMargin: number;
  public dockOb: MyResizeObserver | undefined;
  public mutaionOb: MyMutationObserver | undefined;

  constructor(direction: Direction) {
    this.direction = direction;
    this.tabBar = this.getBar(Layout.center);
    this.maxMargin = this.getMaxMargin();
    this.observe();
  }

  observe() {
    // 标签页移动到新窗口时
    if (!this.layoutDock) {
      if (!this.tabBar) {
        return;
      }
      if ('darwin' === window.siyuan.config.system.os) {
        this.tabBar.style[`marginLeft`] = `${BtnsWidth.mac}px`;
      } else {
        this.tabBar.style[`marginRight`] = `${BtnsWidth.win * 4}px`;
      }
      return;
    }
    if (!UI.topBar || !this.UIDock || !Layout.center) {
      return;
    }
    // 边栏未悬浮的尺寸监听
    this.dockOb = new MyResizeObserver(this.layoutDock, (entry) => {
      if (entry.target.classList.contains('layout--float')) {
        return;
      }
      this.setMargin(entry.contentBoxSize[0].inlineSize);
    });
    // 相关DOM变动监听
    this.mutaionOb = new MyMutationObserver((mutation) => {
      const { target } = mutation;
      if (target instanceof HTMLElement === false) {
        return;
      }
      // 顶栏按钮数量变化
      if (target === UI.topBar || target.classList.contains('toolbar__item')) {
        this.maxMargin = this.getMaxMargin();
        this.setMargin();
      }
      // 悬浮dock
      if (target === this.layoutDock) {
        this.setMargin();
      }
      // dock 入口隐藏
      if (target === this.UIDock) {
        this.maxMargin = this.getMaxMargin();
        this.setMargin();
      }
      // 编辑区域监听
      if (target === Layout.center) {
        // 增加节点监听
        if (mutation.addedNodes[0]?.nodeType === 1) {
          this.resetBar(mutation.addedNodes[0]);
        }
        // 删除节点监听
        if (mutation.removedNodes[0]?.nodeType === 1) {
          this.resetBar(mutation.removedNodes[0]);
        }
      }
    });
    this.mutaionOb.observe(UI.topBar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    this.mutaionOb.observe(this.layoutDock, { attributes: true, attributeFilter: ['class'] });
    this.mutaionOb.observe(this.UIDock, { attributes: true, attributeFilter: ['class'] });
    this.mutaionOb.observe(Layout.center, { childList: true, subtree: true });
  }

  disconnect() {
    this.dockOb?.disconnect();
    this.mutaionOb?.disconnect();
  }

  public get layoutDock() {
    return Layout[`dock${this.direction}`] as HTMLElement | null;
  }

  public get UIDock() {
    return UI[`dock${this.direction}`];
  }

  get isDockExist() {
    return this.UIDock && !this.UIDock.classList.contains('fn__none');
  }

  getBar(parent: Element | null): HTMLElement | null {
    if (!parent) {
      return null;
    }
    const children = [...parent.children] as HTMLElement[];
    const isWnd = children.find((e) => e.dataset.type === 'wnd');

    // 定位到编辑窗口
    if (isWnd) {
      const tabBar = isWnd.children[0] as HTMLElement;
      // 判断是否显示页签栏
      if (!tabBar.classList.contains('fn__none')) {
        return tabBar;
      }
      return null;
    }
    // 未定位到，即分屏情况，递归查询
    const isLRSplitScreen = children.find((e) => e.classList.contains('layout__resize--lr'));
    if (isLRSplitScreen && this.direction === 'Right') {
      // 左右分屏 且 定位方向为右上角
      return this.getBar(children.at(-1) as HTMLElement);
    } else {
      // 上下分屏 或 左右分屏，定位方向为左上角
      return this.getBar(children[0]);
    }
  }

  getMaxMargin() {
    const dockWidth = 40;
    let margin = 0;

    if (!UI.topBar) {
      return margin;
    }
    for (let i = 0; i < UI.topBar.children.length; i++) {
      const btn = UI.topBar.children.item(i);
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
      const { marginLeft, marginRight } = window.getComputedStyle(btn);
      margin += btn.clientWidth + parseFloat(marginLeft) + parseFloat(marginRight);
    }

    if ('darwin' === window.siyuan.config.system.os) {
      margin += this.direction === 'Left' ? BtnsWidth.mac : 2;
    }

    margin -= this.isDockExist ? dockWidth : 0;
    return margin - 8;
  }

  setMargin(value?: number) {
    if (!this.tabBar || !this.layoutDock) {
      return;
    }
    let width = value ?? this.layoutDock.offsetWidth;
    // 悬浮 dock 宽度 = 0
    if (this.layoutDock.classList.contains('layout--float')) {
      width = 0;
    }
    let margin = Math.max(this.maxMargin, width) - width;
    if (width < 0) {
      margin = 0;
    }
    this.tabBar.style[`margin${this.direction}`] = `${margin}px`;
  }

  resetBar(node: Node) {
    if (node instanceof HTMLElement === false) {
      return;
    }
    // 分屏 || 空白页 监听判断
    if (!node.classList?.contains('layout__resize') && !node.querySelector('.layout__empty')) {
      return;
    }
    if (this.tabBar) {
      this.tabBar.style[`margin${this.direction}`] = '0px';
      this.tabBar = this.getBar(Layout.center);
      this.setMargin();
    } else {
      this.tabBar = this.getBar(Layout.center);
    }
  }
}
