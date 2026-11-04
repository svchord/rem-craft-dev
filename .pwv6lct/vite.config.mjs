const p = () => ({
  name: 'probe',
  config(userConfig) {
    console.log(
      '[PROBE] watch=' + JSON.stringify(userConfig.build?.watch) + ' bool=' + Boolean(userConfig.build?.watch)
    );
    return {};
  },
  configResolved(c) {
    console.log('[RESOLVED] watch=' + Boolean(c.build.watch));
  },
});
export default {
  build: { outDir: 'dev', rollupOptions: { input: 'src/index.css' } },
  plugins: [p()],
};
