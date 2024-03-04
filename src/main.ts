import '@/style/main.scss';
import { TabBar } from './plugins/tabBar';

async function loadConfig() {
  const res = await fetch('/appearance/themes/Rem Craft Dev/config.json');
  return res.json();
}

setTimeout(async () => {
  const config = await loadConfig();
  console.log(config);
  let leftBar: TabBar;
  let rightBar: TabBar;
  if (config.tabBar === true) {
    leftBar = new TabBar('Left');
    rightBar = new TabBar('Right');
  }
  window.destroyTheme = () => {
    if (config.tabBar === true) {
      leftBar?.disconnect();
      rightBar?.disconnect();
    }
  };
}, 0);
