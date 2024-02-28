export default {
  pxToNum(str: string) {
    return parseFloat(str);
  },

  numToPx(num: number) {
    return num + 'px';
  },

  fisrtToUpper(str: string) {
    return str.replace(str[0], str[0].toUpperCase());
  },
};
