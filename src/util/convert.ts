export function pxToNum(str: string) {
  return parseFloat(str);
}

export function numToPx(num: number) {
  return num + 'px';
}

export function fisrtToUpper(str: string) {
  return str.replace(str[0], str[0].toUpperCase());
}
