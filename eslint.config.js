// ESLint flat config (Phase D-1).
// 基础规则：仅 lint 仓库内的 .js 源文件。.ts 文件由 vitest 在运行时校验
// （Vite 转译 + 实际执行），不在这里做类型语法检查，避免引入 typescript-eslint
// 工具链。保持 CI 快速、零额外解析器依赖。
import js from '@eslint/js';

export default [
  {
    ignores: [
      'extension/**',
      'extension-firefox/**',
      'dist/**',
      'node_modules/**',
      'website/**',
      '**/*.ts',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        chrome: 'readonly',
        browser: 'readonly',
        self: 'readonly',
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        indexedDB: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        URLSearchParams: 'readonly',
        // Vite 构建期注入（vite.config.js 的 define），不是运行期全局
        __BUILD_TIME__: 'readonly',
      },
    },
    rules: {
      // 必须显式展开 recommended.rules：对象字面量里的 `rules` 会**整体覆盖**上面
      // `...js.configs.recommended` 带进来的那个（同名键后者胜）。之前就是漏了这步，
      // 实际只有下面三条规则在跑，`no-undef` 没生效 —— 于是 store.js 里
      // `getActiveSpace()`（改名后已不存在，见提交 6e091c8）这种未定义引用一路
      // 过关，运行期抛 ReferenceError 被 catch 吞成「口令不正确」，第二台设备
      // 永远过不了口令门禁。.js 不受 tsc 管辖，no-undef 是这类错的唯一防线。
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // E2E 通道（Node 侧脚本）。这里同样是 `no-undef` 唯一防线：.mjs 不受 tsc 管辖，
    // 而「引用了不存在的名字」在这套脚本里是**高频**错误（跨文件 helper 改名、复制粘贴
    // 场景时最容易漏）—— 实测就漏过一个 `findByTitle is not defined`，只有跑到那一步才炸。
    ...js.configs.recommended,
    files: ['scripts/e2e/**/*.mjs'],
    ignores: [
      // 旧 Linux 通道（Xvfb + WebDriver BiDi），保留但不纳入门禁，避免历史噪声淹没真问题
      'scripts/e2e/e2e-*.mjs',
      'scripts/e2e/ff-smoke.mjs',
      'scripts/e2e/supabase-check.mjs',
      'scripts/e2e/debug-create.mjs',
      'scripts/e2e/diag-ops.mjs',
      'scripts/e2e/kill-chromium.sh',
      // 旧通道专用 lib（BiDi / geckodriver / Management API），不属本 harness
      'scripts/e2e/lib/bidi.mjs',
      'scripts/e2e/lib/ffbridge.mjs',
      'scripts/e2e/lib/launch.mjs',
      'scripts/e2e/lib/launchFirefox.mjs',
      'scripts/e2e/lib/popup.mjs',
      'scripts/e2e/lib/supabase.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node 内置
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // Node 22 起是全局（fetch / WebSocket / AbortSignal），但 ESLint 不认识
        fetch: 'readonly',
        WebSocket: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        // 在扩展上下文（SW / 扩展页面）里求值时用到的浏览器全局
        chrome: 'readonly',
        document: 'readonly',
        window: 'readonly',
        location: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
