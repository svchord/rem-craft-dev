import { pxToNum } from '@/util/convert';
import { MyResizeObserver, setMutationObserver } from '@/util/observer';
import { isDockExist, setDockObserver } from '@/util/layout';

const UI = {
  topBar: document.getElementById('toolbar'),
  drag: document.getElementById('drag'),
  dockLeft: document.getElementById('dockLeft'),
  dockRight: document.getElementById('dockRight'),
};

const Layout = {
  center: document.querySelector('layout__center'),
  dockLeft: document.querySelector('layout__dockl'),
  dockRight: document.querySelector('layout__dockR'),
};

enum BtnsWidth {
  mac = 69,
  win = 46,
}

class TabBar {
  public direction: direction;
  public tabBar: HTMLElement | null;
  public maxMargin: number;
  public dockObserver: MyResizeObserver | undefined;

  constructor(direction: direction) {
    this.direction = direction;
    this.tabBar = this.getBar(Layout.center);
    this.maxMargin = this.getMaxMargin();
    this.build();
  }

  build() {
    if (!this.tabBar) {
      return;
    }
    if (!this.layoutDock) {
      // 标签页移动到新窗口时
      if ('darwin' === window.siyuan.config.system.os) {
        this.tabBar.style[`marginLeft`] = `${BtnsWidth.mac}px`;
      } else {
        this.tabBar.style[`marginRight`] = `${BtnsWidth.win * 4}px`;
      }
      return;
    }

    // 边栏未悬浮的尺寸监听
    this.dockObserver = new MyResizeObserver(this.layoutDock, (entry) => {
      if (!this.tabBar || entry.target.classList.contains('layout--float')) {
        return;
      }
      const layoutDockWidth = entry.contentBoxSize[0].inlineSize;
      let margin = Math.max(this.maxMargin, layoutDockWidth) - layoutDockWidth;
      if (layoutDockWidth < 0) {
        margin = 0;
      }
      this.tabBar.style[`margin${this.direction}`] = `${margin}px`;
    });
    this.start();
  }

  get layoutDock() {
    return Layout[`dock${this.direction}`];
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
      margin += btn.clientWidth + pxToNum(marginLeft) + pxToNum(marginRight);
    }

    if ('darwin' === window.siyuan.config.system.os) {
      margin += this.direction === 'Left' ? BtnsWidth.mac : 2;
    }

    margin -= isDockExist(this.direction) ? dockWidth : 0;
    return margin - 8;
  }

  setMargin(direction: direction, value: number) {
    this.tabBar.style[`margin${direction}`] = `${value}px`;
  }

  autoSetMargin(layoutDockWidth) {
    if (!this.tabBar) {
      return;
    }
    if (layoutDockWidth >= 0 && layoutDockWidth <= this.maxMargin) {
      this.setMargin(this.direction, this.maxMargin - layoutDockWidth);
    } else {
      this.setMargin(this.direction, 0);
    }
  }

  resetMargin() {
    if (this.layoutDock.classList.contains('layout--float')) {
      this.autoSetMargin(0);
    } else {
      this.autoSetMargin(pxToNum(this.layoutDock.style.width));
    }
  }

  resetBar() {
    if (this.tabBar) {
      this.setMargin(this.direction, 0);
      this.tabBar = this.getBar(Layout.center);
      this.resetMargin();
    } else {
      this.tabBar = this.getBar(Layout.center);
    }
  }

  isEmpty(hasEmpty) {
    Layout.center.style.paddingTop = hasEmpty ? '36px' : '0';
    UI.drag.style.opacity = hasEmpty ? '1' : '0';
    Layout.center.querySelectorAll('.layout-tab-container').forEach((element) => {
      element.style.borderTopColor = hasEmpty ? 'rgba(var(--border-3))' : 'transparent';
    });
  }

  centerListener(node, operation) {
    // 分屏监听判断
    if (node.classList?.contains('layout__resize')) {
      this.resetBar();
    }
    // 空白页监听判断
    if (node.querySelector('.layout__empty')) {
      this.resetBar();
      this.isEmpty(operation === 'add');
    }
  }

  start() {
    // 边栏监听

    // 顶栏监听
    let topBarObserver = setMutationObserver('childList', () => {
      this.maxMargin = this.getMaxMargin();
      this.resetMargin();
    });
    topBarObserver.observe(UI.topBar, { childList: true, subtree: true });
    // 边栏悬浮的选择器监听
    let layoutDockObserver = setMutationObserver('attributes', () => {
      this.resetMargin();
    });
    layoutDockObserver.observe(this.layoutDock, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // dock栏监听
    setDockObserver(this.direction, () => {
      this.maxMargin = this.getMaxMargin();
      this.resetMargin();
    });

    // 编辑区域监听
    this.isEmpty(Layout.center.querySelector('.layout__empty'));
    let centerObserver = setMutationObserver('childList', (mutation) => {
      // 增加节点监听
      if (mutation?.addedNodes[0]?.nodeType === 1) {
        this.centerListener(mutation.addedNodes[0], 'add');
      }
      // 删除节点监听
      if (mutation?.removedNodes[0]?.nodeType === 1) {
        this.centerListener(mutation.removedNodes[0], 'remove');
      }
    });

    centerObserver.observe(Layout.center, { childList: true, subtree: true });
  }
}

export function tabBarMain() {
  const barLeft = new TabBar('left');
  const barRight = new TabBar('right');
  barLeft.resetMargin();
  barRight.resetMargin();
}
