// SSG 产物自检 —— 逐页核对 SEO meta 是否正确。
//
// 用法：
//   node scripts/check-ssg.mjs         → CLI，自检失败 exit 1
//   import { runChecks } from '…'      → 被 vite-plugin 在构建末尾调用
//
// ★ 这个脚本存在的理由：SEO 出错**不会抛异常**。标题写错、canonical 指到别的页、
//   hreflang 指向同一个 URL —— 构建照样绿，只有爬虫能发现。所以必须机器自查，
//   而且**必须真的抓得住**（改这份脚本后请造探针回归，见文件末尾注释）。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// ★ 页面清单**从路由表与内容清单自动推导**，不手抄。
//   手抄的代价已经付过：sitemap 的 /support 就是因为 vite-plugin 里手抄路由表漏掉的。
//   内容页数量随写作增长，写死更是每加一篇就红一次。
//
//   ★ routes.js 顶层 import 了 .vue（NotFoundView / ContentView），Node 直接 import
//   会报 ERR_UNKNOWN_FILE_EXTENSION。所以只取它的纯数据导出，用正则从源码里抠
//   PUBLIC_ROUTES —— 比整个 import 稳，也比手抄好。
import { CONTENT_ROUTES } from '../src/content/manifest.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const SITE = 'https://www.bookmark-sync.top';

/** 从 routes.js 源码抠出 PUBLIC_ROUTES 的 { path } 列表（避开 .vue import）。 */
function readPublicRoutePaths() {
  const src = readFileSync(resolve(root, 'src/router/routes.js'), 'utf8');
  const block = /export const PUBLIC_ROUTES = \[([\s\S]*?)\];/.exec(src);
  if (!block) throw new Error('[check-ssg] 没能从 routes.js 读到 PUBLIC_ROUTES');
  return [...block[1].matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
}

const PUBLIC_ROUTE_PATHS = readPublicRoutePaths();

/** URL 路径 → dist 内的文件名。Vercel / Cloudflare Pages 按目录 index 提供无扩展名 URL。 */
const fileFor = (urlPath) =>
  urlPath === '/' ? 'index.html' : `${urlPath.replace(/^\//, '')}/index.html`;

function buildPageList() {
  const pages = [];
  for (const basePath of PUBLIC_ROUTE_PATHS) {
    pages.push({ url: basePath, file: fileFor(basePath), locale: 'zh' });
    const enPath = `/en${basePath === '/' ? '' : basePath}`;
    pages.push({ url: enPath, file: fileFor(enPath), locale: 'en' });
  }
  // ★ CONTENT_ROUTES **已经含每种语言各一条**（zh 一条 + en 一条 = 同一篇的两种语言，
  //   见 manifest 生成逻辑）。这里直接用它，不要再为每条补 en ——
  //   补了会让每篇文章在清单里出现两次，进而把期望 URL 数算成 2倍
  //   （第一版就踩了：sitemap 实际 16 条、期望算出 18）。
  //   判据：sitemap 的 buildSitemap 也是「按 slug 去重后由它自己生成两种语言」，
  //   这里的清单必须与之一致。
  for (const c of CONTENT_ROUTES) {
    const base = `/${c.prefix}/${c.slug}`;
    const url = c.locale === 'en' ? `/en${base}` : base;
    pages.push({ url, file: fileFor(url), locale: c.locale, content: true });
  }
  pages.push({ url: null, file: '404.html', locale: 'zh', notFound: true });
  pages.push({ url: null, file: 'en/404.html', locale: 'en', notFound: true });
  return pages;
}

const PAGES = buildPageList();
// 全站只有**一篇**内容文章时，它没有「同分类其它文章」可链，孤岛检查要放过。
// ★ CONTENT_ROUTES 是**每语言一条**（zh 一条 + en 一条 = 同一篇的两种语言），
//   所以要按去重后的 slug 数判断，不能直接用length —— 一篇文章会让 length = 2。
const distinctSlugs = new Set(CONTENT_ROUTES.map((c) => c.slug));
const onlyContent = distinctSlugs.size <= 1;
for (const p of PAGES) {
  if (p.content && onlyContent) p.onlyContent = true;
}

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

/**
 * 取某类标签里的所有 href（属性顺序无关）。
 *
 * ★ 本文件已经因为「正则假设属性顺序」栽了三次：
 *   1. links() 写死 rel 在 href 前 → canonical 探针抓不到（假绿）
 *   2. 目录锚点检查同样写死class 在 href 前 → 抓到 0 条，检查形同虚设
 *   3. hydrate 检查里的属性正则
 * Vue 渲染出来的属性顺序由编译器决定，**不可假设**。所以统一走这里：
 * 先把标签切出来，再逐个属性解析。
 */
function hrefsOf(html, tagName, className) {
  const out = [];
  for (const m of html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'g'))) {
    const tag = m[0];
    if (className) {
      const cls = tag.match(/\bclass="([^"]*)"/);
      // class 里可能有多个类名（scoped 会加 data-v-xxx，不影响 class 本身）
      if (!cls || !cls[1].split(/\s+/).includes(className)) continue;
    }
    const href = tag.match(/\bhref="([^"]*)"/);
    if (href) out.push(href[1]);
  }
  return out;
}

/**
 * 取 **h2** 的 id 数量（属性顺序无关）。
 * ★ 只数 h2：目录（toc）由 parse.js 从 h2 生成、ContentView 仅在 h2 ≥ 3 时渲染。
 *   早先数 h2+h3 会让「h2 少但 h3 多」的合理文章（如常见问题类）被误判成
 *   「目录提取失效」—— 误报的判据必须与目录真正依据的层级一致。
 */
function headingIdsCount(html) {
  return [...html.matchAll(/<h2\b[^>]*>/g)].filter((m) => /\bid="/.test(m[0])).length;
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
    else if (t[0].includes('undefined') || t[0].includes('[object'))
      fail(`${tag} title 含未渲染插值: ${t[0]}`);

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
    else if (p.notFound && !robots[0].includes('noindex'))
      fail(`${tag} 404 页 robots 缺 noindex: ${robots[0]}`);
    else if (!p.notFound && robots[0].includes('noindex'))
      fail(`${tag} 公开页被标了 noindex: ${robots[0]}`);

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
      const badLink = enLinks.find(
        (h) => (p.locale === 'en') !== (h === '/en' || h.startsWith('/en/')),
      );
      if (badLink) fail(`${tag} 页内链接语言不一致: ${badLink}`);
    }

    // 7. JSON-LD 可解析 + 至少 Organization
    const ld = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (m) => m[1],
    );
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
    if (text.length < minText)
      fail(`${tag} 正文文本仅 ${text.length} 字符（阈值 ${minText}，SSG 未生效？）`);

    // 9. og:image / twitter:image 必填（社交卡片）
    if (!metasProp(head, 'og:image').length) fail(`${tag} 缺 og:image`);
    if (!metas(head, 'twitter:image').length) fail(`${tag} 缺 twitter:image`);
  }

  // ── 内容页（markdown 驱动）额外检查 ───────────────────────────────────
  // ★ FAQPage 声明的问答必须与页面上肉眼可见的**一致** —— 声明页面上不存在的问答
  //属于结构化数据滥用，Google 会忽略甚至处罚。只查「有 FAQ 小节就有 FAQPage」不够，
  //   还要比对**条数**（第一版就只查了存在性）。
  for (const p of PAGES) {
    if (!p.content) continue;
    const html = readFileSync(resolve(dist, p.file), 'utf8');
    const head = headOf(html);
    const tag = `[${p.file}]`;

    if (!head.includes('"Article"')) fail(`${tag} 缺 Article JSON-LD`);

    const ldAll = [
      ...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((m) => {
      try {
        return JSON.parse(m[1]);
      } catch {
        return {};
      }
    });
    const faqLd = ldAll.find((o) => o['@type'] === 'FAQPage');
    const visibleCount = (html.match(/class="content-details"/g) || []).length;
    if (visibleCount > 0) {
      if (!faqLd) {
        fail(`${tag} 页面有 ${visibleCount} 条 FAQ 但无 FAQPage JSON-LD`);
      } else if ((faqLd.mainEntity || []).length !== visibleCount) {
        fail(
          `${tag} FAQPage 声明 ${(faqLd.mainEntity || []).length} 条，页面可见 ${visibleCount} 条 —— 必须一致`,
        );
      }
    }

    // 目录锚点必须与正文 h2 的 id 严格对应，否则目录点了跳不过去
    //（两边各自 slugify，一旦实现漂移就是死链，而构建期不报错）。
    const tocAnchors = hrefsOf(html, 'a', 'toc-link')
      .filter((h) => h.startsWith('#'))
      .map((h) => h.slice(1));
    if (tocAnchors.length === 0 && headingIdsCount(html) >= 3) {
      fail(`${tag} 有${headingIdsCount(html)} 个小节标题却一个目录项都没抓到 —— 检查逻辑本身失效`);
    }
    const headingIds = [...html.matchAll(/<h[23]\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    if (tocAnchors.length >= 3) {
      const dead = tocAnchors.filter((a) => !headingIds.includes(a));
      if (dead.length) {
        fail(`${tag} 目录有 ${dead.length} 个锚点匹配不到正文标题: ${dead.slice(0, 3).join(', ')}`);
      }
    }

    // 内容页必须内链到其它内容页（否则是孤岛页，权重传不出去）
    const linksOut = hrefsOf(html, 'a').filter((h) =>
      /^\/(?:en\/)?(?:guide|fix|migrate|explain)\/[^"#]+$/.test(h),
    );
    if (linksOut.length === 0 && !p.onlyContent) {
      fail(`${tag} 内容页无任何指向其它内容页的内链（孤岛页）`);
    }

    // 内容页 canonical 不能是站点根（那是首页的）
    const canon = links(head, 'canonical');
    if (canon.length === 1 && canon[0] === `${SITE}/`) {
      fail(`${tag} 内容页 canonical 指向站点根，应指向自身`);
    }
  }

  // ── SSG 页面的样式完整性（曾真实事故）───────────────────────────────
  // ★ 背景：vite 默认 cssCodeSplit:true 会把每个懒加载视图的样式拆成独立 chunk，
  //   而那些 <link> 是 JS 运行时插入的 → SSG 输出的 HTML <head> 里只有 main.css。
  //   线上表现：页面 HTML 完整、无 JS 报错，但**浏览器首屏渲染出无样式裸文本**，
  //   等 JS 跑完才补上样式并闪烁。构建期不报错、SEO 自检也查不出
  //   （它只查 title/canonical 之类，与样式无关）—— 只有真浏览器看首屏才暴露。
  //
  // 判据：产物里**只应有一个 CSS 文件**，且每一页的 <head> 都必须引用它。
  // 出现第二个 .css 或某页没引用 =分包又回来了。
  const cssFiles = readdirSync(dist + '/assets').filter((f) => f.endsWith('.css'));
  if (cssFiles.length !== 1) {
    fail(
      `产物里有 ${cssFiles.length} 个 CSS 文件（期望 1 个）：${cssFiles.join(', ')}` +
        ' —— cssCodeSplit 被重新打开了？懒加载 chunk 的 CSS 不会被 SSG 注入<head>，' +
        '线上会渲染成无样式裸文本。检查 vite.config.js 的 build.cssCodeSplit:false。',
    );
  }
  for (const p of PAGES) {
    if (!existsSync(resolve(dist, p.file))) continue;
    const html = readFileSync(resolve(dist, p.file), 'utf8');
    const refs = links(headOf(html), 'stylesheet');
    if (refs.length !== 1) {
      fail(`[${p.file}] <head> 里引用了 ${refs.length} 个样式表（期望 1 个），页面可能无样式`);
    } else if (!refs[0].endsWith(cssFiles[0])) {
      fail(`[${p.file}] 引用的样式表是 ${refs[0]}，但产物里唯一的 CSS 是 ${cssFiles[0]}`);
    }
  }

  // 10. sitemap 必须含全部公开 URL，且 hreflang 互指不同 URL
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
      if (hrefs.length < 3)
        fail(`sitemap 某条 URL 的 hreflang 少于 3 个（zh/en/x-default）: ${b.slice(0, 80)}`);
      if (new Set(hrefs).size < 2) fail(`sitemap 某条 URL 的 hreflang 全指向同一 URL: ${hrefs[0]}`);
    }
    // 期望 URL 数 = PAGES 里非 404 的条目数。
    // ★ PAGES 已经**每种语言各有一条**（buildPageList 里 zh、en 都push 了），
    //   所以这里不能再 × 2 —— 写了会翻倍（第一版就踩过：期望值算出 36 而实际 16）。
    //   数量必须由清单推导、内容页增加时不能忘改（之前这里写死 14）。
    const expectedUrlCount = PAGES.filter((x) => !x.notFound).length;
    const urlCount = (sm.match(/<loc>/g) || []).length;
    if (urlCount !== expectedUrlCount) {
      fail(`sitemap 有 ${urlCount} 条 URL，期望 ${expectedUrlCount}（页面清单推导）`);
    }
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
          fail(`[${p.file}] og:image 声明 ${w}x${h}，实际 ${real.w}x${real.h} —— 必须一致`);
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
