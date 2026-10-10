/**
 * JSON-LD 注入 —— Next 的 metadata 不支持结构化数据，只能渲染真实的
 * <script type="application/ld+json">。（会落在 <body>，Google 接受。）
 * '<' 转义防止正文里的 </script> 提前闭合脚本块。
 */
export default function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003C') }}
    />
  );
}
