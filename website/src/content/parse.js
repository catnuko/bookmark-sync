/**
 * markdown 子集解析器 —— 把 content 目录下的 md 解析成结构化 AST。
 *
 * ⚠ 写注释时注意：块注释内不能出现连续的「星号斜杠」，那会提前闭合注释
 *   （本文件第一版就因为在注释里写路径通配符而报语法错）。
 *
 * 刻意只支持我们真正用到的语法（多一个都不支持，写了会在 build 时报错）：
 *   - `# / ## / ###` 标题（h1 作为页首标题消费，正文里再出现会被丢弃）
 *   - 段落
 *   - `- ` 无序列表 / `1. ` 有序列表（支持一层嵌套）
 *   - `> ` 引用块（用于「注意/警告」）
 *   - ``` 代码块（会原样转义，不解析内部）
 *   - 表格（| a | b |，第二行必须是分隔行）
 *   - `**粗体**` 与 `` `行内代码` ``
 *
 * 产出 AST 而不是 HTML 字符串：SSG 与 CSR 都要渲染，AST 在 Vue 侧可以直接 v-for，
 * 而 HTML 字符串要么 v-html（丢样式作用域），要么二次解析（更绕）。
 */

/** 支持的语法白名单 —— 出错时告诉作者「这个语法不支持」而不是静默渲染错。 */
const SUPPORTED =
  '标题(#/##/###)、段落、- 列表、1. 有序列表、> 引用、``` 代码块、| 表格、**粗体**、`行内代码`';

/** 解析行内标记：`**粗体**` 与 `` `代码` ``。其余原样转义。 */
export function parseInline(text) {
  const out = [];
  // 用带捕获的正则一次扫完，避免多次 replace 互相破坏
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'strong', value: m[1] });
    else out.push({ type: 'code', value: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** 按 `|` 切表格行，顺带 trim。 */
function splitRow(line) {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

const isTableSep = (line) => /^\s*\|?[\s:-]*-[-\s|:]*\|?\s*$/.test(line) && line.includes('-');

/**
 * @param {string} src markdown 文本（不含 frontmatter）
 * @param {string} filePath 仅用于报错定位
 * @returns {{ blocks: object[], faq: {q:string,a:string}[], lead: string }}
 *   faq 单独抽出（约定用 `## FAQ` 小节），供 FAQPage JSON-LD 使用。
 */
export function parseMarkdown(src, filePath = '<md>') {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let faq = [];
  let i = 0;

  const fail = (msg, lineNo) => {
    throw new Error(`[content] ${filePath}:${lineNo} ${msg}\n支持的语法：${SUPPORTED}`);
  };

  // ── lead：第一个 h1 之后、第一个 h2 之前的正文，作为页首摘要 ──
  let lead = '';
  {
    const h1 = lines.findIndex((l) => /^#\s+/.test(l));
    if (h1 === -1) fail('缺少一级标题（# 开头）', 1);
    let j = h1 + 1;
    const buf = [];
    while (j < lines.length && !/^##\s+/.test(lines[j])) {
      if (lines[j].trim()) buf.push(lines[j].trim());
      j += 1;
    }
    lead = buf.join(' ').replace(/\*\*/g, '');
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行
    if (!trimmed) {
      i += 1;
      continue;
    }

    // 代码块
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) fail('代码块没有闭合（```）', i);
      i += 1; // 吃掉结束的 ```
      blocks.push({ type: 'code', lang, value: buf.join('\n') });
      continue;
    }

    // 标题
    const h = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      // h1 只在开头允许（作为 lead 区标题，已在上面消费过）；
      // 正文里再出现 h1 说明作者复制粘贴时没改层级，静默忽略比报错更糟 —— 直接丢弃。
      if (level === 1) {
        i += 1;
        continue;
      }
      blocks.push({ type: 'heading', level, text: h[2], inline: parseInline(h[2]) });
      i += 1;
      continue;
    }

    // 表格：当前行含 |，且下一行是分隔行
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitRow(lines[i].trim()));
        i += 1;
      }
      blocks.push({
        type: 'table',
        header: header.map((c) => ({ text: c, inline: parseInline(c) })),
        rows: rows.map((r) => r.map((c) => ({ text: c, inline: parseInline(c) }))),
      });
      continue;
    }

    // 引用块
    if (trimmed.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', inline: parseInline(buf.join(' ')) });
      continue;
    }

    // 列表（有序 / 无序），支持一层 `- ` 嵌套
    const isUl = /^-\s+/.test(trimmed);
    const isOl = /^\d+\.\s+/.test(trimmed);
    if (isUl || isOl) {
      const ordered = isOl;
      const items = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        const re = ordered ? /^\d+\.\s+(.*)$/ : /^-\s+(.*)$/;
        const m = re.exec(l);
        if (!m) {
          // 列表项的续行（缩进）并入上一项
          if (items.length && /^\s{2,}\S/.test(lines[i])) {
            items[items.length - 1].text += ' ' + l;
            i += 1;
            continue;
          }
          break;
        }
        items.push({ text: m[1] });
        i += 1;
      }
      blocks.push({
        type: 'list',
        ordered,
        items: items.map((it) => ({ inline: parseInline(it.text) })),
      });
      continue;
    }

    // 段落：吃到下一个空行或块级起始
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|-\s|\d+\.\s|>\s|```)/.test(lines[i].trim())
    ) {
      buf.push(lines[i].trim());
      i += 1;
    }
    const text = buf.join(' ');
    blocks.push({ type: 'paragraph', inline: parseInline(text) });
  }

  // ── FAQ：抽 `## FAQ` 小节下的 `### 问题` + 回答段落 ──
  faq = extractFaq(blocks, filePath);

  // ── 目录：抽所有 h2（正文里第一个 h2 是 lead 之后那个，FAQ 也计入）
  //   长文没有目录很难读，而内容页普遍 40+ 段落。锚点与 ContentBody.slugOf 保持一致。
  const toc = blocks
    .filter((b) => b.type === 'heading' && b.level === 2)
    .map((b) => ({ text: b.text, anchor: slugOfHeading(b.text) }));

  return { blocks, faq, lead, toc };
}

/** 标题锚点：与 ContentBody.vue 里的 slugOf 必须完全一致，否则目录跳不过去。 */
export function slugOfHeading(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 从 AST 抽 FAQ：约定 `###` 开头是小问题，其后到下一个 `###`/`##` 之间是答案。
 * 抽出来的每一项都会进 FAQPage JSON-LD —— ★ 必须与页面上肉眼可见的问答一致，
 * 声明了页面上不存在的问答属于结构化数据滥用，Google 会忽略甚至处罚。
 */
function extractFaq(blocks, filePath) {
  const faqStart = blocks.findIndex(
    (b) => b.type === 'heading' && b.level === 2 && /^faq$/i.test(b.text.trim()),
  );
  if (faqStart === -1) return [];

  const out = [];
  let current = null;
  for (let i = faqStart + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading' && b.level <= 2) break;
    if (b.type === 'heading' && b.level === 3) {
      if (current) out.push(current);
      current = { q: b.text, a: '' };
      continue;
    }
    if (!current) continue;
    // 答案正文：段落与列表都要，列表转成 "1. xxx 2. xxx"
    if (b.type === 'paragraph') current.a += (current.a ? ' ' : '') + inlineToText(b.inline);
    else if (b.type === 'list') {
      const s = b.items
        .map((it, n) => `${b.ordered ? `${n + 1}.` : '-'} ${inlineToText(it.inline)}`)
        .join(' ');
      current.a += (current.a ? ' ' : '') + s;
    }
  }
  if (current) out.push(current);

  for (const it of out) {
    if (!it.a) throw new Error(`[content] ${filePath} FAQ「${it.q}」没有答案正文`);
  }
  return out;
}

/** inline AST → 纯文本（用于 FAQ 答案与 meta description）。 */
export function inlineToText(inline) {
  return inline.map((n) => n.value).join('');
}

/** 解析 frontmatter（`---\nkey: value\n---`）。只支持扁平字符串值，不引号不做转义。 */
export function parseFrontmatter(src) {
  if (!src.startsWith('---')) return { data: {}, body: src };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: src };
  const head = src.slice(4, end);
  const body = src.slice(end + 4).replace(/^\n/, '');
  const data = {};
  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) data[k] = v;
  }
  return { data, body };
}
