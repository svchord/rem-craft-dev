/**
 * 编辑窗口的方向
 */
type Direction = 'Left' | 'Right';

/**
 * 包装后的编辑窗口
 */
interface Tab {
  /**
   * 当前方向
   *
   * @type {Direction}
   */
  direction: Direction;

  /**
   * 当前 Tab 的编辑窗口
   *
   * @type {(HTMLElement | null)}
   */
  wnd: HTMLElement | null;

  /**
   * 当前 Tab 的最大 margin
   *
   * @type {number}
   */
  maxMargin: number;

  /**
   * 设置选择器和样式
   */
  init(): void;

  /**
   * 清空选择器和样式
   */
  clear(): void;

  /**
   * 重置选择器和样式
   */
  reset(): void;

  /**
   * 递归获取目标编辑窗口
   *
   * @param parent 父元素
   * @returns 目标窗口
   */
  getWnd(parent: Element | null): HTMLElement | null;

  /**
   * 返回根据顶栏按钮计算的margin最大值
   *
   * @returns margin最大值
   */
  calMaxMargin(): number;

  /**
   * 重新计算margin最大值
   */
  recalMaxMargin(): void;

  /**
   * 返回计算得到的dock栏可视宽度
   *
   * @returns dock栏可视宽度
   */
  calLayoutDockWidth(): number;

  /**
   * 根据传参 value
   * 或者 margin 最大值和 dock 栏可视宽度
   * 设置当前 margin
   *
   * @param value
   */
  setMargin(value?: number);

  /**
   * 根据传参 value
   * 或者 dock 栏可视宽度
   * 设置当前编辑窗口圆角
   *
   * @param width
   */
  setRadius(value?: number);

  /**
   * 当前方向的 dock 入口栏是否显示
   *
   * @readonly
   */
  readonly isDockExist: boolean | null;

  /**
   * 当前方向的编辑窗口选择器
   *
   * @readonly
   */
  readonly wndClassName: string;

  /**
   * 当前方向的编辑窗口圆角选择器
   *
   * @readonly
   */
  readonly radiusClassName: string;

  /**
   * 当前方向的css变量名
   *
   * @readonly
   */
  readonly cssVar: string;
}

/**
 * Tab 的构造函数类型
 */
type TabConstructor = new (direction: Direction) => Tab;

/**
 * 包装后的编辑窗口监听器
 */
interface TabObserver {
  /**
   * 当前方向
   *
   * @type {Direction}
   */
  direction: Direction;

  /**
   * 当前方向的 Tab
   *
   * @type {Tab}
   */
  tab: Tab;

  /**
   * 当前方向的 dock 栏尺寸监听器
   *
   * @type {(MyResizeObserver | undefined)}
   */
  dockOb: MyResizeObserver | undefined;

  /**
   * 当前 Tab 相关 Dom 的监听器集合
   *
   * @type {(MutationObserverSet | undefined)}
   */
  mutaionObSet: MutationObserverSet | undefined;

  /**
   * 监听相关dom元素，并修改tab状态
   */
  observe(): void;

  /**
   * 取消监听
   */
  disconnect(): void;
}

/**
 * TabObserver 的构造函数类型
 */

type TabObserverConstructor = new (direction: Direction) => TabObserver;
