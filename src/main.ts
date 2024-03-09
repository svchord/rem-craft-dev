import '@/style/main.scss';
import { TabObserver } from './plugins/tabBar';

async function loadConfig() {
  const res = await fetch('/appearance/themes/Rem Craft Dev/config.json');
  return res.json();
}

setTimeout(async () => {
  const CONFIG = await loadConfig();
  const body = document.body;
  console.log(CONFIG);
  let leftTabObserver: TabObserver;
  let rightTabObserver: TabObserver;
  if (CONFIG.tabBar === true && !body.classList.contains('body--window')) {
    leftTabObserver = new TabObserver('Left');
    rightTabObserver = new TabObserver('Right');
    body.classList.add('rc-tab-bar');
  }
  window.destroyTheme = () => {
    if (CONFIG.tabBar === true && !body.classList.contains('body--window')) {
      leftTabObserver?.disconnect();
      rightTabObserver?.disconnect();
      body.classList.remove('rc-tab-bar');
    }
  };
}, 0);
