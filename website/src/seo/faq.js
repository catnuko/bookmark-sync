/**
 * FAQ 数据提取 —— 把 i18n 消息里的 FAQ 条目转成 FAQPage JSON-LD 用的结构。
 *
 * 为什么单独抽：页面上渲染 FAQ 的组件（FAQSection / SupportView）各自维护了一份
 * key 列表，两处可能不同步。**JSON-LD 必须与页面上肉眼可见的问答一致** ——
 * 声明了页面上不存在的问答属于结构化数据滥用，Google 会直接忽略甚至处罚。
 * 所以这里以「页面组件自己声明的 key 顺序」为准，组件里改 key 必须同步改这里。
 *
 * 已知不一致（故意保留，不要强行统一）：
 *   - pricing.faq.items : 12 条（FAQSection，home + pricing 共用）
 *   - support.faq.items : 9 条（SupportView）
 */

/** 首页/定价页 FAQ（FAQSection.vue 的 faqKeys，顺序即页面顺序） */
export const PRICING_FAQ_KEYS = [
  'upgrade',
  'order',
  'refund',
  'freeLimit',
  'payment',
  'subOrOnetime',
  'passphrase',
  'newDevice',
  'devices',
  'autoSync',
  'gc',
  'quotaUnit',
];

/** 支持页 FAQ（SupportView.vue 的 faqKeys，顺序即页面顺序） */
export const SUPPORT_FAQ_KEYS = [
  'account',
  'browsers',
  'free',
  'restore',
  'security',
  'passphrase',
  'conflict',
  'gc',
  'accountBar',
];

/**
 * @param {object} messages 完整的 i18n messages（zh.json 或 en.json）
 * @param {'pricing.faq.items'|'support.faq.items'} namespace
 * @param {string[]} keys
 * @returns {{q: string, a: string}[]} 缺键的条目会被跳过（宁可少声明，不可声明错的）
 */
export function pickFaqItems(messages, namespace, keys) {
  const bucket = namespace.split('.').reduce((o, k) => o?.[k], messages);
  if (!bucket) return [];
  const out = [];
  for (const key of keys) {
    const it = bucket[key];
    if (it && typeof it.q === 'string' && typeof it.a === 'string') {
      out.push({ q: it.q, a: it.a });
    }
  }
  return out;
}
