import '@/style/main.scss';
import { createTabObserver } from './plugin/tab';

async function loadConfig() {
  const res = await fetch('/appearance/themes/Rem Craft Dev/config.json');
  return res.json();
}

setTimeout(async () => {
  const config = await loadConfig();
  const body = document.body;
  console.log(config);

  const { tab } = config;
  const TabObserver = createTabObserver();
  let tabObserver;
  if (tab.switch && !body.classList.contains('body--window')) {
    tabObserver = new TabObserver();
    body.classList.add('rc-tab');
    if (tab.chromeStyle) {
      body.classList.add('rc-tab-chrome');
    }
  }
  window.destroyTheme = () => {
    if (tab.switch && !body.classList.contains('body--window')) {
      tabObserver?.disconnect();
      body.classList.remove('rc-tab');
      if (tab.chromeStyle) {
        body.classList.remove('rc-tab-chrome');
      }
    }
  };
}, 0);
