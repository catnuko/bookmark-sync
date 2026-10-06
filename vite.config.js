import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

/**
 * 本地开发凭据注入（**只在本地生效**）。
 *
 * 真值放在仓库根的 `.dev-creds.json`（已 gitignore，见 .gitignore）：
 *   { "email": "...", "password": "...", "passphrase": "...",
 *     "aiKey": "sk-..." }
 *
 * 为什么走文件而不是环境变量：环境变量会进 shell 历史；而这个文件
 * 既不入 git，也能被 vite.config.js 读到。
 *
 * ★ CI 与正式发版拿不到这个值 —— 文件不在仓库里，CI 上不存在 → 空对象 →
 * `__DEV_CREDS__` 编译成空串，**商店包与 GitHub Release 产物不含任何凭据**。
 * 这也是为什么不把凭据写进 src/（src 会进 git、会被 CI 打包）。
 *
 * ★★ `aiKey` 与 email/password 的风险等级不同：那两个顶多泄露一个测试账号，
 * `aiKey` 是**有余额的付费凭证**，泄露 = 别人花你的钱。所以除了 gitignore，
 * 还有一道「打包闸」兜底：scripts/package-zips.mjs 会在打包前扫产物，
 * 发现 `sk-` 开头的 key 就**拒绝打包**（见该文件）。
 */
function readDevCreds() {
  const f = resolve(import.meta.dirname, '.dev-creds.json');
  if (!existsSync(f)) return {};
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    return {
      email: String(raw.email ?? ''),
      password: String(raw.password ?? ''),
      passphrase: String(raw.passphrase ?? ''),
      // ★ 只认 sk- 前缀的 key。写错成别的（内网 token、占位符）时宁可留空，
      // 也不要让一段「疑似凭据但其实不是」的字符串白白进产物。
      aiKey: /^sk-/.test(String(raw.aiKey ?? '')) ? String(raw.aiKey).trim() : '',
    };
  } catch (e) {
    console.warn('[vite] .dev-creds.json 解析失败，本次构建不注入凭据：', e.message);
    return {};
  }
}

// 多入口构建：options（选项页，Vue 3）+ background（MV3 service worker）
// 产物输出到 extension/，manifest.json 由 public/ 一并拷贝。
export default defineConfig({
  base: './',
  plugins: [vue()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __DEV_CREDS__: JSON.stringify(readDevCreds()),
  },
  server: {
    sourcemap: true,
  },
  build: {
    outDir: 'extension',
    emptyOutDir: true,
    // 显式关闭生产 sourcemap：防止 .map 随扩展 zip 分发泄露源码。
    // （release.yml 的 CI 同样跑 vite build，这里一处关掉即同时覆盖本地和 CI。）
    sourcemap: false,
    rollupOptions: {
      input: {
        options: resolve(import.meta.dirname, 'options.html'),
        popup: resolve(import.meta.dirname, 'popup.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
