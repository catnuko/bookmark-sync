/**
 * FAQ 数据提取 —— 把 i18n 消息里的 FAQ 条目转成 FAQPage JSON-LD 用的结构。
 * （迁移前 src/seo/faq.js 的 TS 移植，**保留原有 key 列表，不改 SEO 输出**。）
 *
 * ★ 已知漂移（迁移时**刻意原样保留**，不在框架迁移范围内改动）：
 *   - 页面实际渲染的 FAQ 条数与这里的 key 数不一致（FAQSection 6 条 vs 12，
 *     SupportView 6 条 vs 9），且首页并不渲染可见 FAQ 但仍输出 FAQPage。
 *   这是迁移前就存在的问题，改动会改变 SEO 输出，故单独提出、不混进迁移。
 */
import { messages, type Locale } from '@/i18n/t';

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

export function pickFaqItems(
  messages: unknown,
  namespace: string,
  keys: string[],
): { q: string; a: string }[] {
  const bucket = namespace
    .split('.')
    .reduce<unknown>(
      (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
      messages,
    );
  if (!bucket) return [];
  const out: { q: string; a: string }[] = [];
  for (const key of keys) {
    const it = (bucket as Record<string, { q?: unknown; a?: unknown }>)[key];
    if (it && typeof it.q === 'string' && typeof it.a === 'string') {
      out.push({ q: it.q, a: it.a });
    }
  }
  return out;
}

/**
 * 按 seoKey 决定 FAQPage JSON-LD 用哪组 key —— 对应迁移前 vite-plugin.js 的
 * `faqFor` 映射。★ 注意 `home` 也输出 FAQPage（12 条），尽管首页**不再渲染**
 * 可见 FAQ —— 这是迁移前就存在的漂移，原样保留，不改 SEO 输出。
 */
const FAQ_FOR: Record<string, { ns: string; keys: string[] }> = {
  home: { ns: 'pricing.faq.items', keys: PRICING_FAQ_KEYS },
  pricing: { ns: 'pricing.faq.items', keys: PRICING_FAQ_KEYS },
  support: { ns: 'support.faq.items', keys: SUPPORT_FAQ_KEYS },
};

export function faqItemsFor(seoKey: string, locale: Locale): { q: string; a: string }[] {
  const f = FAQ_FOR[seoKey];
  if (!f) return [];
  return pickFaqItems(messages[locale], f.ns, f.keys);
}
