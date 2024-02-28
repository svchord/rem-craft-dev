import { numToPx, pxToNum } from '@/util/convert';
import { setResizeObserver, setMutationObserver } from '@/util/observer';
import { isDockExist, getLayoutDock, setDockObserver } from '@/util/layout';

const DOM = {
  layoutCenter: document.getElementsByClassName('layout__center')[0],
  topBar: document.getElementById('toolbar'),
  drag: document.getElementById('drag'),
};

enum BtnsWidth {
  mac = 69,
  win = 46,
}

class TabBar {
  public direction: direction;
  public bar: Element | undefined;
  public layoutDock: Element | undefined;
  public maxMargin: number | undefined;

  constructor(direction: direction) {
    this.direction = direction;
    this.bar = this.getBar(DOM.layoutCenter);
    this.maxMargin = this.getMaxMargin();
    this.layoutDock = getLayoutDock(direction);
    if (this.layoutDock) {
      this.start();
    } else if ('darwin' === window.siyuan.config.system.os) {
      this.setMargin('left', BtnsWidth.mac);
    } else {
      this.setMargin('right', BtnsWidth.win * 4);
    }
  }

  getBar(parent: Element | undefined): Element | undefined {
    if (!parent) {
      return;
    }
    const children = [...parent.children];
    const isWnd = children.find((e) => (e as HTMLElement).dataset.type === 'wnd');

    // 定位到编辑窗口
    if (isWnd) {
      const tabBar = isWnd.children[0];
      // 判断是否显示页签栏
      if (!tabBar.classList.contains('fn__none')) {
        return tabBar;
      }
      return;
    }
    // 未定位到，即分屏情况，递归查询
    const isSplitScreen = children.find((e) => e.classList.contains('layout__resize--lr'));
    if (isSplitScreen && this.direction === 'right') {
      // 左右分屏 且 定位方向为右上角
      return this.getBar(children.at(-1));
    } else {
      // 上下分屏 或 左右分屏，定位方向为左上角
      return this.getBar(children[0]);
    }
  }

  getMaxMargin() {
    const dockWidth = 40;
    let margin = 0;

    if (!DOM.topBar) {
      return;
    }
    for (let i = 0; i < DOM.topBar.children.length; i++) {
      const btn = DOM.topBar.children.item(i);
      if (btn.id === 'drag') {
        if (this.direction === 'left') {
          break;
        } else {
          margin = 0;
          continue;
        }
      }
      let style = window.getComputedStyle(btn);
      margin += btn.clientWidth + pxToNum(style.marginLeft) + pxToNum(style.marginRight);
    }

    if ('darwin' === window.siyuan.config.system.os) {
      margin += this.direction === 'left' ? BtnsWidth.mac : 2;
    }

    margin -= isDockExist(this.direction) ? dockWidth : 0;
    return margin - 8;
  }

  setMargin(direction, value) {
    direction === 'left'
      ? (this.bar.style.marginLeft = numToPx(value))
      : (this.bar.style.marginRight = numToPx(value));
  }

  autoSetMargin(layoutDockWidth) {
    if (!this.bar) {
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
    if (this.bar) {
      this.setMargin(this.direction, 0);
      this.bar = this.getBar(DOM.layoutCenter);
      this.resetMargin();
    } else {
      this.bar = this.getBar(DOM.layoutCenter);
    }
  }

  isEmpty(hasEmpty) {
    DOM.layoutCenter.style.paddingTop = hasEmpty ? '36px' : '0';
    DOM.drag.style.opacity = hasEmpty ? '1' : '0';
    DOM.layoutCenter.querySelectorAll('.layout-tab-container').forEach((element) => {
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
    // 顶栏监听
    let topBarObserver = setMutationObserver('childList', () => {
      this.maxMargin = this.getMaxMargin();
      this.resetMargin();
    });
    topBarObserver.observe(DOM.topBar, { childList: true, subtree: true });

    // 边栏监听
    // 边栏未悬浮的尺寸监听
    let layoutDockSizeObserver = setResizeObserver((entry) => {
      if (!entry.target.classList.contains('layout--float')) {
        let layoutDockWidth = entry.contentBoxSize[0].inlineSize;
        this.autoSetMargin(layoutDockWidth);
      }
    });
    layoutDockSizeObserver.observe(this.layoutDock);
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
    this.isEmpty(DOM.layoutCenter.querySelector('.layout__empty'));
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

    centerObserver.observe(DOM.layoutCenter, { childList: true, subtree: true });
  }
}

export function tabBarMain() {
  const barLeft = new TabBar('left');
  const barRight = new TabBar('right');
  barLeft.resetMargin();
  barRight.resetMargin();
}
