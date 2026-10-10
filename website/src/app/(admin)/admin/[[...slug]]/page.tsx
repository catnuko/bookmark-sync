import type { Metadata } from 'next';
import AdminApp from '@/admin/AdminApp';

// /admin 是纯客户端后台，不进索引。
// ★ 给一个静态 title：迁移前的后台路由虽有 meta.title，但没有任何代码消费它，
//   于是标签页标题为空。这里补上（浏览器标签 / 历史记录可读），比迁移前更完整。
export const metadata: Metadata = {
  title: 'BSYNC · Admin',
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
