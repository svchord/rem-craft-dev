/**
 * 选项维度的默认值——属于样式契约，不是运行时数据。
 *
 * 默认值决定 opt:<name>:<默认值>: 编译成 :not([data-rc-<name>])（属性缺失即默认），
 * 其余值编译成 [data-rc-<name>="<value>"]。这份知识只影响选择器生成，
 * 所以放在构建层，不读 public/theme-setting.json——那个文件是插件的运行时数据，
 * 主题可以完全没有它。
 */
export const OPTION_DEFAULTS = {
  style: 'm3',
} as const;

export type OptionName = keyof typeof OPTION_DEFAULTS;
