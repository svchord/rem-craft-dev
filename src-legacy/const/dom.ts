export function UI() {
  return {
    topBar: () => document.getElementById('toolbar'),
    drag: () => document.getElementById('drag'),
    dock: (direction: Direction) => document.getElementById(`dock${direction}`),
  };
}

export function Layout() {
  return {
    center: () => document.querySelector('.layout__center') as HTMLElement | null,
    empty: () => document.querySelector('.layout__empty') as HTMLElement | null,
    dock: (direction: Direction) =>
      document.querySelector(
        `.layout__dock${direction[0].toLocaleLowerCase()}`
      ) as HTMLElement | null,
  };
}
