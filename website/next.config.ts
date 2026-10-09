import type { NextConfig } from 'next';

/**
 * 静态导出 —— 与迁移前「纯静态文件 + Vercel」的部署模型保持一致。
 *   - output:'export' → 产物落在 out/（Next 不再需要服务端运行时）。
 *   - trailingSlash:false → 与旧 vercel.json 一致，URL 形如 /pricing（无尾斜杠）。
 *   - images.unoptimized:true → 默认图片优化依赖服务端，静态导出下不可用；
 *     站点本来就用普通 <img>，无需优化管线。
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
};

export default nextConfig;
