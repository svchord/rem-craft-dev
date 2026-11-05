/**
 * 等待时长与超时的唯一来源，以及唯一的 sleep 实现。
 *
 * 这些值来自实测：思源的菜单/停靠栏是异步渲染的，插件重载由 WebSocket 推送，
 * 主题样式在壳子之后才挂载。之前十几个裸数字散在 actions/measure/session/
 * kernel 里，改一个动作要翻四个文件，也没人说得清为什么是 900 而不是 350。
 *
 * 原则：能用 waitForFunction 等条件就不要固定 sleep；下面的固定值都是
 * 「条件不可观测」时的兜底，按触发原因分组，不按数值分组。
 */
export const TIMING = {
  /** 指针/键盘/属性动作后等 CSS 过渡与同步布局落定。 */
  actionSettle: 250,
  /** 真实点击后可能触发异步面板加载，比纯指针动作久一点。 */
  clickSettle: 500,
  /** :hover 由真实指针驱动，等过渡完成。 */
  hoverSettle: 350,
  /** 思源菜单异步渲染，实测 600ms 后 DOM 稳定。 */
  menuSettle: 600,
  /** 右键菜单要等思源自己的 contextmenu 处理链，最慢。 */
  contextMenuSettle: 900,
  /** 停靠栏面板首次懒加载。 */
  dockSettle: 800,
  /** 改 <html> 属性后等明/暗与密度样式重算。 */
  attrSettle: 300,
  /** diff 前先移开指针，让 :hover 态退掉。 */
  diffBeforeSettle: 250,
  /** diff 动作后等过渡。 */
  diffAfterSettle: 350,
  /** 新页面壳子加载后等主题 link 挂载。 */
  pageReady: 1500,
  /** 主题样式等待上限；超时不报错，由 environment 读数反映。 */
  themeStyleWait: 5000,
  /** 换 href 后等新样式表 load/error 的上限。 */
  stylesheetLoad: 1500,
  /** 等 dev 会话整页刷新完成（拿到读租约）的上限。 */
  refreshReadyTimeout: 20000,
  /** 刷新前等所有读租约释放的上限；超时照常刷新并警告。 */
  readLeaseDrainTimeout: 10000,
  /** 禁用→启用插件之间留一次 WebSocket 往返。 */
  pluginReloadGap: 500,
  /** 打开新页面/等待 siyuan.config 的超时。 */
  navigationTimeout: 30000,
  /** 控制服务端点探测超时（本机回环）。 */
  controlProbe: 800,
  /** kernel 端口探测超时（本机回环）。 */
  kernelProbe: 1500,
  /** 问工作区列表的超时。 */
  workspacesProbe: 3000,
  /** attach / 最后一步的短停顿。 */
  navSettle: 400,
} as const;

/** 唯一的 sleep 实现。之前 measure/actions/session 各写了一份逐字相同的。 */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
