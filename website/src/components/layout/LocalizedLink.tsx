'use client';

// LocalizedLink —— 自动补语言前缀的站内链接（迁移前 LocalizedLink.vue 的 React 版）。
//
// 为什么需要：/en/pricing 页面上如果出现指向 /pricing 的链接，爬虫顺着爬到的就是
// 中文页 → hreflang cluster 在抓取层面断裂。规则：按**当前 URL 的语言**加前缀。
// admin 链接不要用这个组件（后台不带语言前缀）。
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { localeFromPath, pathForLocale } from '@/i18n/paths';

type Props = Omit<React.ComponentProps<typeof Link>, 'href'> & { to: string };

export default function LocalizedLink({ to, ...rest }: Props) {
  const pathname = usePathname() || '/';
  let target = to;
  // 只处理站内绝对路径；外链 / 带 query / mailto 原样透传
  if (to.startsWith('/') && !(to.startsWith('/en/') || to === '/en')) {
    target = pathForLocale(to, localeFromPath(pathname));
  }
  return <Link href={target} {...rest} />;
}
