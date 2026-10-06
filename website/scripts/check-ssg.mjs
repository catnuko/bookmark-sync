// SSG 产物自检 —— 逐页核对 SEO meta 是否正确。
//
// 用法：
//   node scripts/check-ssg.mjs         → CLI，自检失败 exit 1
//   import { runChecks } from '…'      → 被 vite-plugin 在构建末尾调用
//
// ★ 这个脚本存在的理由：SEO 出错**不会抛异常**。标题写错、canonical 指到别的页、
//   hreflang 指向同一个 URL —— 构建照样绿，只有爬虫能发现。所以必须机器自查，
//   而且**必须真的抓得住**（改这份脚本后请造探针回归，见文件末尾注释）。
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const SITE = 'https://www.bookmark-sync.top';

const PAGES = [
  { url: '/', file: 'index.html', locale: 'zh' },
  { url: '/pricing', file: 'pricing/index.html', locale: 'zh' },
  { url: '/download', file: 'download/index.html', locale: 'zh' },
  { url: '/docs', file: 'docs/index.html', locale: 'zh' },
  { url: '/support', file: 'support/index.html', locale: 'zh' },
  { url: '/privacy', file: 'privacy/index.html', locale: 'zh' },
  { url: '/terms', file: 'terms/index.html', locale: 'zh' },
  { url: '/en', file: 'en/index.html', locale: 'en' },
  { url: '/en/pricing', file: 'en/pricing/index.html', locale: 'en' },
  { url: '/en/download', file: 'en/download/index.html', locale: 'en' },
  { url: '/en/docs', file: 'en/docs/index.html', locale: 'en' },
  { url: '/en/support', file: 'en/support/index.html', locale: 'en' },
  { url: '/en/privacy', file: 'en/privacy/index.html', locale: 'en' },
  { url: '/en/terms', file: 'en/terms/index.html', locale: 'en' },
  { url: null, file: '404.html', locale: 'zh', notFound: true },
  { url: null, file: 'en/404.html', locale: 'en', notFound: true },
];

/** 取所有 <title>。数量必须恰好为 1 —— 两个 title 爬虫取哪个不可控。 */
function titles(head) {
  return [...head.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map((m) => m[1].trim());
}

/** 取 head 段（第一个 </head> 之前），避免正文里的同名标签干扰。 */
function headOf(html) {
  const i = html.indexOf('</head>');
  return i === -1 ? html : html.slice(0, i);
}

/**
 * 取 <meta name=X content=Y> / <link rel=X href=Y>。
 * ★ 正则**不假设属性顺序**：真实产物里 unhead 可能输出 `hreflang` 在 `rel` 之前。
 *   之前写成 `<link[^>]*rel="X"[^>]*href="Y"` 时，因为某页的 canonical 被 SSR 排到
 *   alternates 后面而侥幸匹配上，但探针（故意把 canonical 指错页）竟然没被抓到 ——
 *   说明这条正则在某些顺序下会静默失配，让自检变成假绿。
 */
function attrTags(head, kind, key, valAttr, valName) {
  const re = new RegExp(`<${kind}\\b[^>]*>`, 'g');
  const out = [];
  for (const m of head.matchAll(re)) {
    const tag = m[0];
    const km = tag.match(new RegExp(`\\b${key}=["']([^"']*)["']`));
    if (!km || km[1] !== valName) continue;
    const vm = tag.match(new RegExp(`\\b${valAttr}=["']([^"']*)["']`));
    if (vm) out.push(vm[1]);
  }
  return out;
}

const metas = (head, name) => attrTags(head, 'meta', 'name', 'content', name);
const metasProp = (head, prop) => attrTags(head, 'meta', 'property', 'content', prop);
const links = (head, rel) => attrTags(head, 'link', 'rel', 'href', rel);

/** 读 JPEG SOFn 段拿真实像素宽高（og:image 尺寸核对用）。 */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0..SOF15，排除 SOF4(DHT) / SOF8(JPG) / SOF12(CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
/** hreflang 需要连 key 一起取（三个 alternate 共用 rel="alternate"） */
function alternateLinks(head) {
  const out = [];
  for (const m of head.matchAll(/<link\b[^>]*>/g)) {
    const tag = m[0];
    const rel = tag.match(/\brel=["']alternate["']/);
    if (!rel) continue;
    const hl = tag.match(/\bhreflang=["']([^"']*)["']/);
    const href = tag.match(/\bhref=["']([^"']*)["']/);
    if (hl && href) out.push([hl[1], href[1]]);
  }
  return out;
}

export function runChecks({ quiet = false } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (m) => errors.push(m);

  for (const p of PAGES) {
    const filePath = resolve(dist, p.file);
    if (!existsSync(filePath)) {
      fail(`[${p.file}] 文件不存在`);
      continue;
    }
    const html = readFileSync(filePath, 'utf8');
    const head = headOf(html);
    const tag = `[${p.file}]`;

    // 1. title 恰好一个
    const t = titles(head);
    if (t.length !== 1) fail(`${tag} <title> 数量 = ${t.length}（应为 1）: ${JSON.stringify(t)}`);
    else if (!t[0]) fail(`${tag} <title> 为空`);
    else if (t[0].includes('undefined') || t[0].includes('[object')) fail(`${tag} title 含未渲染插值: ${t[0]}`);

    // 2. description 恰好一个且非空
    const desc = metas(head, 'description');
    if (desc.length !== 1) fail(`${tag} description 数量 = ${desc.length}（应为 1）`);
    else if (!desc[0]) fail(`${tag} description 为空`);

    // 3. canonical：公开页恰好 1 个且自指；404 页**不应有** canonical
    const canon = links(head, 'canonical');
    if (p.notFound) {
      if (canon.length > 0) fail(`${tag} 404 页不应有 canonical（指向 ${canon[0]}）`);
    } else if (canon.length !== 1) {
      fail(`${tag} canonical 数量 = ${canon.length}（应为 1）: ${JSON.stringify(canon)}`);
    } else if (canon[0] !== SITE + p.url) {
      fail(`${tag} canonical = ${canon[0]}，期望 ${SITE + p.url}`);
    }

    // 4. robots
    const robots = metas(head, 'robots');
    if (robots.length !== 1) fail(`${tag} robots 数量 = ${robots.length}（应为 1）`);
    else if (p.notFound && !robots[0].includes('noindex')) fail(`${tag} 404 页 robots 缺 noindex: ${robots[0]}`);
    else if (!p.notFound && robots[0].includes('noindex')) fail(`${tag} 公开页被标了 noindex: ${robots[0]}`);

    // 5. html lang 与 locale 一致
    const htmlLang = html.match(/<html[^>]*\blang="([^"]*)"/)?.[1];
    const wantLang = p.locale === 'zh' ? 'zh-CN' : 'en';
    if (htmlLang !== wantLang) fail(`${tag} <html lang> = ${htmlLang}，期望 ${wantLang}`);

    // 6. hreflang（公开页）：zh/en 必须指向**不同** URL + x-default
    const alts = alternateLinks(head);
    if (!p.notFound) {
      const byLang = Object.fromEntries(alts);
      for (const hl of ['zh-CN', 'en', 'x-default']) {
        if (!byLang[hl]) fail(`${tag} 缺 hreflang=${hl}（实际有 ${JSON.stringify(alts)}）`);
      }
      if (byLang['zh-CN'] && byLang.en && byLang['zh-CN'] === byLang.en) {
        fail(`${tag} hreflang zh-CN 与 en 指向同一 URL（${byLang['zh-CN']}）—— 违背 hreflang 规范`);
      }
      if (p.locale === 'en' && byLang.en && byLang.en !== SITE + p.url) {
        fail(`${tag} hreflang=en 指向 ${byLang.en}，期望 ${SITE + p.url}`);
      }
      // 中文页的 hreflang zh-CN 必须自指
      if (p.locale === 'zh' && byLang['zh-CN'] && byLang['zh-CN'] !== SITE + p.url) {
        fail(`${tag} 中文页 hreflang=zh-CN 指向 ${byLang['zh-CN']}，期望自指 ${SITE + p.url}`);
      }
      // 页内链接不得跨语言（英文页里链到中文页会断掉 hreflang cluster）
      const enLinks = [...html.matchAll(/<a[^>]*href="(\/[^"#]*)"/g)].map((m) => m[1]);
      const badLink = enLinks.find((h) => p.locale === 'en' !== (h === '/en' || h.startsWith('/en/')));
      if (badLink) fail(`${tag} 页内链接语言不一致: ${badLink}`);
    }

    // 7. JSON-LD 可解析 + 至少 Organization
    const ld = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    if (ld.length === 0) fail(`${tag} 无 JSON-LD`);
    for (const raw of ld) {
      try {
        const o = JSON.parse(raw);
        if (o.url && !o['@type']) fail(`${tag} JSON-LD 有 url 但无 @type: ${raw.slice(0, 80)}`);
      } catch (e) {
        fail(`${tag} JSON-LD 解析失败: ${e.message} :: ${raw.slice(0, 100)}`);
      }
    }
    if (!ld.some((x) => x.includes('"Organization"'))) fail(`${tag} 缺 Organization JSON-LD`);

    // 8. 正文非空（SSG 的核心目的）。404 页本来就没多少字，用更低阈值。
    const minText = p.notFound ? 100 : 200;
    if (html.includes('<div id="app"></div>')) fail(`${tag} app 容器仍为空（SSG 未注入）`);
    const bodyHtml = html.slice(html.indexOf('<div id="app">'));
    const text = bodyHtml
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < minText) fail(`${tag} 正文文本仅 ${text.length} 字符（阈值 ${minText}，SSG 未生效？）`);

    // 9. og:image / twitter:image 必填（社交卡片）
    if (!metasProp(head, 'og:image').length) fail(`${tag} 缺 og:image`);
    if (!metas(head, 'twitter:image').length) fail(`${tag} 缺 twitter:image`);
  }

  // 10. sitemap 必须含全部 14 条公开 URL，且 hreflang 互指不同 URL
  const smPath = resolve(dist, 'sitemap.xml');
  if (!existsSync(smPath)) {
    fail('sitemap.xml 不存在');
  } else {
    const sm = readFileSync(smPath, 'utf8');
    for (const p of PAGES.filter((x) => !x.notFound)) {
      if (!sm.includes(`<loc>${SITE + p.url}</loc>`)) fail(`sitemap 缺 ${SITE + p.url}`);
    }
    for (const b of sm.split('<url>').slice(1)) {
      const hrefs = [...b.matchAll(/hreflang="[^"]*" href="([^"]*)"/g)].map((m) => m[1]);
      if (hrefs.length < 3) fail(`sitemap 某条 URL 的 hreflang 少于 3 个（zh/en/x-default）: ${b.slice(0, 80)}`);
      if (new Set(hrefs).size < 2) fail(`sitemap 某条 URL 的 hreflang 全指向同一 URL: ${hrefs[0]}`);
    }
    const urlCount = (sm.match(/<loc>/g) || []).length;
    if (urlCount !== 14) fail(`sitemap 有 ${urlCount} 条 URL（期望 14 = 7 页 × 2 语言）`);
  }

  // 10. robots 必须禁 admin 并指向 sitemap
  const rbPath = resolve(dist, 'robots.txt');
  if (!existsSync(rbPath)) {
    fail('robots.txt 不存在');
  } else {
    const rb = readFileSync(rbPath, 'utf8');
    if (!rb.includes('Disallow: /admin')) fail('robots.txt 未禁 /admin');
    if (!rb.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail('robots.txt 未指向 sitemap');
  }

  // 11. og:image 声明的宽高必须等于图片实际像素。
  //     声明与实物不符 → LinkedIn/Slack 等按声明尺寸缩放后再裁剪，分享卡片糊掉或主体被切。
  const ogPath = resolve(dist, 'og-image.jpg');
  if (!existsSync(ogPath)) {
    fail('og-image.jpg 不存在（社交卡片会没有图）');
  } else {
    const real = jpegSize(readFileSync(ogPath));
    if (!real) {
      fail('无法解析 og-image.jpg 尺寸（文件可能损坏）');
    } else {
      for (const p of PAGES.filter((x) => !x.notFound)) {
        const head = headOf(readFileSync(resolve(dist, p.file), 'utf8'));
        const w = metasProp(head, 'og:image:width')[0];
        const h = metasProp(head, 'og:image:height')[0];
        if (String(real.w) !== String(w) || String(real.h) !== String(h)) {
          fail(
            `[${p.file}] og:image 声明 ${w}x${h}，实际 ${real.w}x${real.h} —— 必须一致`,
          );
        }
      }
    }
  }

  if (!quiet) {
    console.log(`\n检查 ${PAGES.length} 个页面 + sitemap + robots`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
    if (errors.length) {
      console.log(`\n❌ ${errors.length} 个错误:`);
      errors.forEach((e) => console.log('  - ' + e));
    } else {
      console.log('\n✅ 全部通过\n');
    }
  }

  return { errors, warnings };
}

// CLI 直跑（被 vite 插件 import 时不走这段）
if (process.argv[1] && process.argv[1].endsWith('check-ssg.mjs')) {
  const { errors } = runChecks();
  if (errors.length) process.exit(1);
}
