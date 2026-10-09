/**
 * 发布日期格式化 —— 内容列表与文章页共用，**必须是纯函数**。
 *
 * ★ 刻意不用 Intl.DateTimeFormat：Node（SSG）与浏览器（hydrate）的 ICU 数据
 *   可能不一致，同一个日期会渲染出不同字符串 → hydration mismatch。手写月份表
 *   保证服务端与客户端输出逐字符一致。
 *
 * @param {string} iso  'YYYY-MM-DD'
 * @param {string} locale 'zh' | 'en'
 * @returns {string} zh → 2026年10月10日；en → Oct 10, 2026
 */
const MONTHS = {
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export function formatDate(iso, locale = 'zh') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const [, y, mm, dd] = m;
  const lang = locale === 'en' ? 'en' : 'zh';
  const month = MONTHS[lang][Number(mm) - 1] || mm;
  return lang === 'en' ? `${month} ${Number(dd)}, ${y}` : `${y}年${month}${Number(dd)}日`;
}
