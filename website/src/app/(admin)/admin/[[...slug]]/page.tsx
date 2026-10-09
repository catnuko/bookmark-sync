import type { Metadata } from 'next';
import AdminApp from '@/admin/AdminApp';

// /admin 是纯客户端后台，不进索引。
export const metadata: Metadata = {
  robots: 'noindex, nofollow',
};

// 已知后台 URL —— 让 next dev 与静态导出都能生成外壳页。
// /admin/users/<id> 这种运行期 id 不在此列，靠 vercel.json 的 rewrite 兜底。
const ADMIN_SEGMENTS = [
  [],
  ['login'],
  ['forbidden'],
  ['users'],
  ['orders'],
  ['subscriptions'],
  ['audit'],
  ['feedback'],
  ['system'],
];

export function generateStaticParams() {
  return ADMIN_SEGMENTS.map((slug) => ({ slug }));
}

export default function AdminPage() {
  return <AdminApp />;
}
