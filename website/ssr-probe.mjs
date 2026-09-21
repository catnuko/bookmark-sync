import { createServer } from 'vite';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { default: PrivacyView } = await vite.ssrLoadModule('/src/views/PrivacyView.vue');
  const { default: TermsView } = await vite.ssrLoadModule('/src/views/TermsView.vue');
  const { i18n } = await vite.ssrLoadModule('/src/i18n/index.js');

  for (const [name, Comp] of [
    ['PrivacyView', PrivacyView],
    ['TermsView', TermsView],
  ]) {
    try {
      const app = createSSRApp(Comp);
      app.use(i18n);
      const html = await renderToString(app);
      console.log(`[OK] ${name} rendered, ${html.length} chars`);
    } catch (e) {
      console.log(`[RUNTIME ERROR] ${name}:`, e && e.message);
      console.log(e && e.stack && e.stack.split('\n').slice(0, 6).join('\n'));
    }
  }
} catch (e) {
  console.log('[LOAD ERROR]', e && e.stack);
}
await vite.close();
