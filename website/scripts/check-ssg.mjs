// SSG 产物自检 —— 逐页核对 SEO meta 是否正确。
//
// 用法：
//   node scripts/check-ssg.mjs         → CLI，自检失败 exit 1
//
// ★ 这个脚本存在的理由：SEO 出错**不会抛异常**。标题写错、canonical 指到别的页、
//   hreflang 指向同一个 URL —— 构建照样绿，只有爬虫能发现。所以必须机器自查，
//   而且**必须真的抓得住**（改这份脚本后请造探针回归，见文件末尾注释）。
//
// ★ 迁移到 Next.js 后的差异（相对旧 Vite 产物）：
//   · 产物目录 dist/ → out/，且是「每页一个 .html」而非「每页一个 <dir>/index.html」。
//   · JSON-LD 由 React 组件渲染在 **<body>** 里（不在 <head>），故整篇扫描。
//   · CSS 由 Next 按路由分块（不再是「全站唯一一个 .css」），改为校验
//     「全局 token 样式表存在且被每一页 <head> 引用」。
//   · 目录锚点 / FAQ 计数改用**与实现无关**的判据（href="#…" / <details>），
//     不再依赖被 CSS Modules 哈希过的类名。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_ROUTES } from '../src/lib/routes.mjs';
import { CONTENT_ROUTES } from '../src/content/manifest.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'out');
const SITE = 'https://www.bookmark-sync.top';

const PUBLIC_ROUTE_PATHS = PUBLIC_ROUTES.map((r) => r.path);

/** URL 路径 → out 内的文件名。Next 静态导出（trailingSlash:false）每页一个 .html。 */
const fileFor = (urlPath) => (urlPath === '/' ? 'index.html' : `${urlPath.replace(/^\//, '')}.html`);

function buildPageList() {
  const pages = [];
  for (const basePath of PUBLIC_ROUTE_PATHS) {
    pages.push({ url: basePath, file: fileFor(basePath), locale: 'zh' });
    const enPath = `/en${basePath === '/' ? '' : basePath}`;
    pages.push({ url: enPath, file: fileFor(enPath), locale: 'en' });
  }
  // ★ CONTENT_ROUTES **已经含每种语言各一条**（zh 一条 + en 一条 = 同一篇的两种语言），
  //   不要再为每条补 en —— 补了会让每篇文章在清单里出现两次。
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
 * ★ 正则**不假设属性顺序**：属性顺序由编译器决定，不可假设。
 */
function attrTags(head, kind, key, valAttr, valName) {
  const re = new RegExp(`<${kind}\\b[^>]*>`, 'g');
  const result = [];
  for (const m of head.matchAll(re)) {
    const tag = m[0];
    const km = tag.match(new RegExp(`\\b${key}=["']([^"']*)["']`));
    if (!km || km[1] !== valName) continue;
    const vm = tag.match(new RegExp(`\\b${valAttr}=["']([^"']*)["']`));
    if (vm) result.push(vm[1]);
  }
  return result;
}

/** 取某类标签里的所有 href（属性顺序无关）。 */
function hrefsOf(html, tagName, className) {
  const result = [];
  for (const m of html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'g'))) {
    const tag = m[0];
    if (className) {
      const cls = tag.match(/\bclass="([^"]*)"/);
      if (!cls || !cls[1].split(/\s+/).includes(className)) continue;
    }
    const href = tag.match(/\bhref="([^"]*)"/);
    if (href) result.push(href[1]);
  }
  return result;
}

/**
 * 取 **h2** 的 id 数量（属性顺序无关）。
 * ★ 只数 h2：目录（toc）由 parse.js 从 h2 生成、ContentPage 仅在 h2 ≥ 3 时渲染。
 */
function headingIdsCount(html) {
  return [...html.matchAll(/<h2\b[^>]*>/g)].filter((m) => /\bid="/.test(m[0])).length;
}

const metas = (head, name) => attrTags(head, 'meta', 'name', 'content', name);
const metasProp = (head, prop) => attrTags(head, 'meta', 'property', 'content', prop);
const links = (head, rel) => attrTags(head, 'link', 'rel', 'href', rel);

/**
 * URL 归一化（仅用于比较）：去掉结尾斜杠。
 * ★ Next 的 metadata 会按 `trailingSlash: false` 把 URL 归一化，于是首页 canonical
 *   输出 `https://host`（无斜杠），而 `SITE + '/'` 是 `https://host/`。二者按 RFC 3986
 *   等价（空路径 == "/"），爬虫一视同仁 —— 比较时归一化即可，不必强求字节一致。
 */
const norm = (u) => (u ? u.replace(/\/$/, '') : u);

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
/** hreflang 需要连 key 一起取（三个 alternate 共用 rel="alternate"）。
 *  ★ 属性名大小写不敏感：Next 的 metadata 输出的是 `hrefLang`（camelCase），
 *   而 HTML5 规定属性名按 ASCII 大小写不敏感解析，所以爬虫照样认。
 *   正则必须带 `i`，否则会静默漏掉全部 hreflang（假绿）。 */
function alternateLinks(head) {
  const result = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\brel=["']alternate["']/i.test(tag)) continue;
    const hl = tag.match(/\bhreflang=["']([^"']*)["']/i);
    const href = tag.match(/\bhref=["']([^"']*)["']/i);
    if (hl && href) result.push([hl[1], href[1]]);
  }
  return result;
}

/** 整篇扫描 JSON-LD（Next 把它渲染在 <body>，不在 <head>）。 */
function jsonLdBlocks(html) {
  return [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );
}

/** 正文纯文本长度（去 script/style/标签）。 */
function bodyTextLength(html) {
  const i = html.indexOf('<body');
  const body = i === -1 ? html : html.slice(i);
  return body
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

export function runChecks({ quiet = false } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (m) => errors.push(m);

  for (const p of PAGES) {
    const filePath = resolve(out, p.file);
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
    } else if (norm(canon[0]) !== norm(SITE + p.url)) {
      fail(`${tag} canonical = ${canon[0]}，期望 ${SITE + p.url}`);
    }

    // 4. robots
    // ★ zh 的 404.html 会同时带 Next 内建的 `<meta name="robots" content="noindex">`
    //   与我们的 `noindex, nofollow`（两个 root layout 下没有共享 404，两份都留着）。
    //   爬虫取最严格者合并，语义正确 —— 所以 404 只要求「至少一个且含 noindex」，
    //   不再要求恰好一个。
    const robots = metas(head, 'robots');
    if (p.notFound) {
      if (!robots.some((r) => r.includes('noindex')))
        fail(`${tag} 404 页 robots 缺 noindex: ${JSON.stringify(robots)}`);
    } else if (robots.length !== 1) {
      fail(`${tag} robots 数量 = ${robots.length}（应为 1）`);
    } else if (robots[0].includes('noindex')) {
      fail(`${tag} 公开页被标了 noindex: ${robots[0]}`);
    }

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
      if (p.locale === 'en' && byLang.en && norm(byLang.en) !== norm(SITE + p.url)) {
        fail(`${tag} hreflang=en 指向 ${byLang.en}，期望 ${SITE + p.url}`);
      }
      // 中文页的 hreflang zh-CN 必须自指
      if (p.locale === 'zh' && byLang['zh-CN'] && norm(byLang['zh-CN']) !== norm(SITE + p.url)) {
        fail(`${tag} 中文页 hreflang=zh-CN 指向 ${byLang['zh-CN']}，期望自指 ${SITE + p.url}`);
      }
      // 页内链接不得跨语言（英文页里链到中文页会断掉 hreflang cluster）。
      // ★ 例外：语言切换链接**本就指向本页的另一语言版本**，是 hreflang cluster
      //   里正当的互链，放行；其它跨语言链接才判错。
      const counterpart =
        p.locale === 'zh'
          ? p.url === '/'
            ? '/en'
            : `/en${p.url}`
          : p.url === '/en'
            ? '/'
            : p.url.slice(3);
      const enLinks = [...html.matchAll(/<a[^>]*href="(\/[^"#]*)"/g)].map((m) => m[1]);
      const badLink = enLinks.find(
        (h) => (p.locale === 'en') !== (h === '/en' || h.startsWith('/en/')) && h !== counterpart,
      );
      if (badLink) fail(`${tag} 页内链接语言不一致: ${badLink}`);
    }

    // 7. JSON-LD 可解析 + 至少 Organization（整篇扫描：Next 渲染在 body）
    const ld = jsonLdBlocks(html);
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
    const textLen = bodyTextLength(html);
    if (textLen < minText)
      fail(`${tag} 正文文本仅 ${textLen} 字符（阈值 ${minText}，SSG 未生效？）`);

    // 9. og:image / twitter:image 必填（社交卡片）
    if (!metasProp(head, 'og:image').length) fail(`${tag} 缺 og:image`);
    if (!metas(head, 'twitter:image').length) fail(`${tag} 缺 twitter:image`);
  }

  // ── 内容页（markdown 驱动）额外检查 ───────────────────────────────────
  // ★ FAQPage 声明的问答必须与页面上肉眼可见的**一致** —— 声明页面上不存在的问答
  //   属于结构化数据滥用，Google 会忽略甚至处罚。比对**条数**而非仅存在性。
  for (const p of PAGES) {
    if (!p.content) continue;
    const html = readFileSync(resolve(out, p.file), 'utf8');
    const head = headOf(html);
    const tag = `[${p.file}]`;

    if (!html.includes('"Article"')) fail(`${tag} 缺 Article JSON-LD`);

    const ldAll = jsonLdBlocks(html).map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    });
    const faqLd = ldAll.find((o) => o['@type'] === 'FAQPage');
    // ★ 可见 FAQ = 页面里的 <details> 数（ContentPage 的 FAQ 项；类名被 CSS Modules
    //   哈希过，不能拿类名当判据）。内容页正文的 markdown AST 不会产出 <details>。
    const visibleCount = (html.match(/<details\b/g) || []).length;
    if (visibleCount > 0) {
      if (!faqLd) {
        fail(`${tag} 页面有 ${visibleCount} 条 FAQ 但无 FAQPage JSON-LD`);
      } else if ((faqLd.mainEntity || []).length !== visibleCount) {
        fail(
          `${tag} FAQPage 声明 ${(faqLd.mainEntity || []).length} 条，页面可见 ${visibleCount} 条 —— 必须一致`,
        );
      }
    }

    // 目录锚点必须与正文标题的 id 严格对应，否则目录点了跳不过去。
    // ★ 判据与实现无关：取页内 `href="#x"` 锚点，逐个核对文档里存在 id="x"。
    const anchors = [...html.matchAll(/<a\b[^>]*\bhref="#([^"]+)"/g)].map((m) => m[1]);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    if (anchors.length === 0 && headingIdsCount(html) >= 3) {
      fail(`${tag} 有 ${headingIdsCount(html)} 个小节标题却一个目录项都没抓到 —— 检查逻辑本身失效`);
    }
    if (anchors.length >= 3) {
      const dead = anchors.filter((a) => !ids.has(a));
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
  // ★ 背景：旧 Vite 方案里 cssCodeSplit 会把懒加载视图的样式拆成独立 chunk，而
  //   那些 <link> 是 JS 运行时插入的 → SSG 的 <head> 只有 main.css，首屏渲染成
  //   无样式裸文本，等 JS 跑完才补上并闪烁。构建期不报错、SEO 自检也查不出。
  //
  //   Next 会按路由把 CSS 分块（不再是「全站唯一一个 .css」），但**全局 token
  //   样式表（main.css）必须出现在每一页 <head> 的关键路径里**。判据：
  //     1) out/_next/static/chunks 里**恰好一个** CSS 文件定义全局 token（--color-bg-soft）
  //     2) 每一页的 <head> 都引用它
  //     3) 页面引用的每个样式表在磁盘上真实存在
  const cssDir = resolve(out, '_next/static/chunks');
  const cssFiles = existsSync(cssDir)
    ? readdirSync(cssDir).filter((f) => f.endsWith('.css'))
    : [];
  const globalCss = cssFiles.filter((f) =>
    /--color-bg-soft:/.test(readFileSync(resolve(cssDir, f), 'utf8')),
  );
  if (globalCss.length !== 1) {
    fail(
      `定义全局 token 的样式表有 ${globalCss.length} 个（期望 1 个）：${globalCss.join(', ')}` +
        ' —— main.css 被拆分/丢失？首屏可能无样式。',
    );
  }
  const globalCssHref = globalCss.length === 1 ? `/_next/static/chunks/${globalCss[0]}` : null;
  for (const p of PAGES) {
    if (!existsSync(resolve(out, p.file))) continue;
    const html = readFileSync(resolve(out, p.file), 'utf8');
    const refs = links(headOf(html), 'stylesheet');
    if (refs.length < 1) {
      fail(`[${p.file}] <head> 里没有样式表引用，页面会无样式首屏`);
      continue;
    }
    if (globalCssHref && !refs.includes(globalCssHref)) {
      fail(`[${p.file}] <head> 未引用全局样式表 ${globalCssHref}（引用了 ${refs.join(', ')}）`);
    }
    for (const href of refs) {
      if (!href.startsWith('/_next/')) continue;
      if (!existsSync(resolve(out, href.replace(/^\//, '')))) {
        fail(`[${p.file}] 引用了不存在的样式表 ${href}`);
      }
    }
  }

  // 10. sitemap 必须含全部公开 URL，且 hreflang 互指不同 URL
  const smPath = resolve(out, 'sitemap.xml');
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
    // 期望 URL 数 = PAGES 里非 404 的条目数（已含每种语言各一条，不能再 ×2）。
    const expectedUrlCount = PAGES.filter((x) => !x.notFound).length;
    const urlCount = (sm.match(/<loc>/g) || []).length;
    if (urlCount !== expectedUrlCount) {
      fail(`sitemap 有 ${urlCount} 条 URL，期望 ${expectedUrlCount}（页面清单推导）`);
    }
  }

  // 11. robots 必须禁 admin 并指向 sitemap
  const rbPath = resolve(out, 'robots.txt');
  if (!existsSync(rbPath)) {
    fail('robots.txt 不存在');
  } else {
    const rb = readFileSync(rbPath, 'utf8');
    if (!rb.includes('Disallow: /admin')) fail('robots.txt 未禁 /admin');
    if (!rb.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail('robots.txt 未指向 sitemap');
  }

  // 12. og:image 声明的宽高必须等于图片实际像素。
  const ogPath = resolve(out, 'og-image.jpg');
  if (!existsSync(ogPath)) {
    fail('og-image.jpg 不存在（社交卡片会没有图）');
  } else {
    const real = jpegSize(readFileSync(ogPath));
    if (!real) {
      fail('无法解析 og-image.jpg 尺寸（文件可能损坏）');
    } else {
      for (const p of PAGES.filter((x) => !x.notFound)) {
        const head = headOf(readFileSync(resolve(out, p.file), 'utf8'));
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

// CLI 直跑
if (process.argv[1] && process.argv[1].endsWith('check-ssg.mjs')) {
  const { errors } = runChecks();
  if (errors.length) process.exit(1);
}
