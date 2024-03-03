import '@/style/main.scss';
import { TabBar } from './plugins/tabBar';

async function loadConfig() {
  const res = await fetch('/appearance/themes/Rem Craft Dev/config.json');
  const config = await res.json();
  console.log(config);
}
(async function () {
  await loadConfig();
  const LeftBar = new TabBar('Left');
  const RightBar = new TabBar('Right');
  window.destroyTheme = () => {
    LeftBar.disconnect();
    RightBar.disconnect();
  };
})();
