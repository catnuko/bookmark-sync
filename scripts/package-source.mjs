// 打包 AMO（addons.mozilla.org）审核用源码包（无依赖，纯 Node 实现）：
//   dist/bookmark-sync-source-<ver>.zip
//
// 为什么需要：Firefox 上架要求随二进制包一并提交「源码包」，审核员需能自行
// 构建出与提交包一致的产物。Chromium 商店不要求源码，所以本包只挂 GitHub
// Release，不进官网下载页（Supabase Storage）。
//
// 内容 = 能复现 Firefox 产物的最小源码集 + 构建说明 BUILD.md（见下方 BUILD_MD）：
//   src/ public/ options.html popup.html vite.config.js
//   package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .nvmrc
//   README.md scripts/build-firefox.mjs
// 刻意排除：node_modules/、extension/、extension-firefox/、dist/、website/、
//   supabase/、tests/、docs/、bookmark-sync/（Xcode 壳）、.github/ 等与扩展构建无关的工程。
//
// 用法：node scripts/package-source.mjs [version]
//   不带参数时版本号取 package.json；CI 里显式传 resolve job 定下的版本。
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { makeZip, walkFiles } from './lib/zip.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ver = process.argv[2] || pkg.version;
const OUT = `dist/bookmark-sync-source-${ver}.zip`;
// 先摊到 dist/source/ 再整包压缩：makeZip 以目录为根，路径即 zip 内的相对路径。
const STAGE = 'dist/source';

// 打进源码包的条目（相对仓库根）。目录递归拷贝；单文件先建父目录再拷。
const ENTRIES = [
  'src',
  'public',
  'options.html',
  'popup.html',
  'vite.config.js',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  '.nvmrc',
  'README.md',
  'scripts/build-firefox.mjs',
];

const BUILD_MD = `# Build instructions (AMO source review)

This archive is the complete source of the Firefox add-on **bookmark-sync ${ver}**.
The submitted package \`bookmark-sync-firefox-${ver}.zip\` is produced from this
source by the steps below. No remote code is loaded and no obfuscation is used.

## Requirements

- Node.js 20 (see \`.nvmrc\`)
- pnpm 10

## Build steps

Run from the root of the extracted archive:

\`\`\`bash
# 1. enable pnpm 10 (skip if already installed)
corepack enable && corepack prepare pnpm@10 --activate

# 2. install the locked dependency tree
pnpm install --frozen-lockfile

# 3. bundle the extension into extension/  (Chromium MV3 layout)
npx vite build

# 4. derive the Firefox package into extension-firefox/
node scripts/build-firefox.mjs
\`\`\`

\`extension-firefox/\` is the directory that was zipped and submitted to AMO.

## How the build maps to the submitted files

| file in the submitted package | produced from |
| --- | --- |
| \`manifest.json\` | \`public/manifest.firefox.json\` (swapped in at step 4) |
| \`background.js\` | \`src/background.ts\` (Vite entry, step 3) |
| \`options.html\`, \`assets/*\` | \`options.html\` + \`src/\` (Vite, step 3) |
| \`popup.html\`, \`assets/*\` | \`popup.html\` + \`src/\` (Vite, step 3) |
| \`icons/*\`, \`_locales/*\` | \`public/\` (copied verbatim at step 3) |

Step 3 bundles \`src/\` with Vite and copies \`public/\` verbatim into
\`extension/\`. Step 4 copies \`extension/\` to \`extension-firefox/\` and replaces
\`manifest.json\` with the Firefox variant, because Firefox does not support the
MV3 \`background.service_worker\` field (it is rewritten to \`background.scripts\`).

## Notes

- The build injects the build time as the compile-time constant \`__BUILD_TIME__\`
  (\`vite.config.js\`, consumed in \`src/background.ts\` and
  \`src/lib/telemetry.ts\`), so a fresh build embeds a new timestamp. That
  timestamp — and the content-hashed asset filenames derived from it — is the
  **only** difference between two builds of this source; every other byte is
  identical.
- \`src/lib/supabase.ts\` contains only the project's public Supabase URL and the
  **anonymous** API key. Access control is enforced server-side by Postgres Row
  Level Security; no privileged/service key ships in the extension.
- Bookmark operations are encrypted on the device (AES-256-GCM) before upload;
  the server stores ciphertext only.
`;

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const rel of ENTRIES) {
  const dest = join(STAGE, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(rel, dest, { recursive: true });
}
writeFileSync(join(STAGE, 'BUILD.md'), BUILD_MD);

const zip = makeZip(STAGE);
writeFileSync(OUT, zip);
const names = walkFiles(STAGE).map((f) => relative(STAGE, f).replaceAll('\\', '/'));
console.log(
  `[package-source] ${OUT} (${(zip.length / 1024).toFixed(1)} KB, ${names.length} 个文件, 含 BUILD.md)`,
);
