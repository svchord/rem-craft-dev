export const UI = {
  topBar: () => document.getElementById('toolbar'),
  drag: () => document.getElementById('drag'),
  dock: (direction: Direction) => document.getElementById(`dock${direction}`),
};

export const Layout = {
  center: () => document.querySelector('.layout__center'),
  dock: (direction: Direction) =>
    document.querySelector(`.layout__dock${direction[0].toLocaleLowerCase()}`),
};

export enum BtnsWidth {
  mac = 69,
  win = 46,
}
