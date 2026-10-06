/**
 * unhead v1 的 SSR head 渲染器。
 *
 * 为什么自己写：v1 只有 `resolveTags()`（返回 tag 描述对象数组），
 * **没有** v2 的 `head.renderDOMHead()`。tag 结构实测为：
 *   { tag:'title', textContent }
 *   { tag:'meta'|'link', props:{...} }
 *   { tag:'htmlAttrs'|'bodyAttrs', props:{...} }   ← 这两个不是真标签，是要合并到 <html>/<body>
 *   { tag:'script'|'style', props:{...}, innerHTML|textContent }
 *
 * 自写渲染器还带来一个额外好处：可以顺手做两件 unhead 默认不做的事 ——
 *   1. **HTML 转义**。description 里有引号/&时必须转义，否则 meta 被截断。
 *   2. **属性顺序稳定**，产物 diff 干净，便于回归比对。
 */

const VOID_TAGS = new Set(['meta', 'link', 'base']);

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 属性值转义。JSON-LD 的 innerHTML 走 escapeText，会把 " 变成 &quot; —— 那会破坏 JSON。 */
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** JSON-LD 里的 `<` 必须转义，否则 </script> 会提前闭合脚本块（XSS 向量）。 */
function escapeScript(s) {
  return String(s).replace(/</g, '\\u003C').replace(/>/g, '\\u003E');
}

function renderAttrs(props = {}) {
  return Object.entries(props)
    .filter(([, v]) => v !== false && v !== undefined && v !== null)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`))
    .join('');
}

/**
 * @param {object[]} tags head.resolveTags() 的返回值
 * @returns {{ headHtml: string, htmlAttrs: string, bodyAttrs: string }}
 *   htmlAttrs/bodyAttrs 需由调用方写回模板的 <html>/<body> 标签上。
 */
export function renderHeadTags(tags = []) {
  const out = [];
  let htmlAttrs = '';
  let bodyAttrs = '';

  for (const t of tags) {
    switch (t.tag) {
      case 'title':
        out.push(`<title>${escapeText(t.textContent ?? '')}</title>`);
        break;
      case 'htmlAttrs':
        htmlAttrs = renderAttrs(t.props);
        break;
      case 'bodyAttrs':
        bodyAttrs = renderAttrs(t.props);
        break;
      case 'script':
      case 'style': {
        const content = t.innerHTML ?? t.textContent ?? '';
        const safe =
          t.tag === 'script' && t.props?.type === 'application/ld+json'
            ? escapeScript(content)
            : content;
        out.push(`<${t.tag}${renderAttrs(t.props)}>${safe}</${t.tag}>`);
        break;
      }
      default:
        if (VOID_TAGS.has(t.tag)) {
          out.push(`<${t.tag}${renderAttrs(t.props)}>`);
        } else {
          out.push(
            `<${t.tag}${renderAttrs(t.props)}>${escapeText(t.textContent ?? '')}</${t.tag}>`,
          );
        }
    }
  }

  return { headHtml: out.join('\n    '), htmlAttrs, bodyAttrs };
}
