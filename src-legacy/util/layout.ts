import { fisrtToUpper, numToPx } from './convert.js';

export const prefix = 'rc';

export function getLayoutDock(direction: direction): Element | undefined {
  return document.getElementsByClassName(`layout__dock${direction[0]}`)[0];
}

export function setWndPadding(direction, value) {
  let layoutDock = getLayoutDock(direction);
  let layoutDockObserver = setMutationObserver('attributes', () => {
    if (!layoutDock.children?.length) {
      return;
    }
    let resize = layoutDock.querySelector('.layout__resize');
    let topWnd = layoutDock.firstElementChild;
    let bottomWnd = [...layoutDock.children].at(-2);
    if (resize?.classList.contains('fn__none') && bottomWnd?.classList.contains('fn__none')) {
      topWnd.firstElementChild.style.paddingBottom = numToPx(value);
      bottomWnd.firstElementChild.style.paddingBottom = '0';
    } else {
      topWnd.firstElementChild.style.paddingBottom = '0';
      bottomWnd.firstElementChild.style.paddingBottom = numToPx(value);
    }
  });
  if (layoutDock) {
    layoutDockObserver.observe(layoutDock, {
      attributes: true,
      subtree: true,
    });
  }
}
