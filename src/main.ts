import '@/style/main.scss';

async function test() {
  const res = await fetch('/appearance/themes/Rem Craft Dev/config.json');
  const config = await res.json();
  console.log(config);
}
test();
