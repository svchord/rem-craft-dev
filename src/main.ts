import '@/style/main.scss';
import { TabBar } from './plugins/tabBar';

async function test() {
  const res = await fetch('/appearance/themes/Rem Craft Dev/config.json');
  const config = await res.json();
  console.log(config);
}
test();

const LeftBar = new TabBar('Left');
const RightBar = new TabBar('Right');

window.destroyTheme = () => {
  LeftBar.disconnect();
  RightBar.disconnect();
};
