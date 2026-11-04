const p = () => ({
  name: 'probe',
  config(userConfig, env) {
    console.log(
      '[PROBE] command=' +
        env.command +
        ' build.watch=' +
        JSON.stringify(userConfig.build?.watch) +
        ' NODE_ENV=' +
        (process.env.NODE_ENV || '(unset)')
    );
    return {};
  },
});
export default { build: { outDir: 'dev', rollupOptions: { input: 'src/index.css' } }, plugins: [p()] };
