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
        console: 'readonly',
        navigator: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
