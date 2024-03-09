export function UI() {
  return {
    topBar: () => document.getElementById('toolbar'),
    drag: () => document.getElementById('drag'),
    dock: (direction: Direction) => document.getElementById(`dock${direction}`),
  };
}

export function Layout() {
  return {
    center: () => document.querySelector('.layout__center'),
    dock: (direction: Direction) =>
      document.querySelector(`.layout__dock${direction[0].toLocaleLowerCase()}`),
  };
}
