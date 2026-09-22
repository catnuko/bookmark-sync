/**
 * src/lib/errors.ts — 把「抛出的东西」变成可读字符串。
 *
 * 为什么值得单独一个模块：**`String(e)` / `` `${e}` `` 对非 Error 抛出物会产出
 * `"[object Object]"`**，把唯一的线索丢光。supabase 的 PostgrestError、以及不少
 * 库抛的普通对象都属于这一类 —— 于是同步失败时，UI 与日志里只剩
 * `{"ok":false,"reason":"error","error":"[object Object]"}`，既看不出哪个 RPC 失败、
 * 也看不出服务端说了什么。
 *
 * 这个坑是 2026-09-22 排查 E2E 的 two-device-sync「删除后同步失败」时踩到的：
 * 报错形状一模一样，注释里查了三处 `reason: 'error'` 才发现信息全被吞了。
 * 此后**新增任何 `reason: 'error'` 分支都必须走这里**。
 *
 * ⚠ 本函数的**唯一职责就是不丢信息**，所以它自己也不能退化成 `[object Object]`：
 * 初版在 `JSON.stringify` 抛错时返回 `Object.prototype.toString.call(e)`，那正是
 * 要消灭的形状 —— 2026-09-22 复跑 E2E 时当场又被这个退化作废了一次排障。
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const props = Object.getOwnPropertyNames(e);
    try {
      // 带上 own 属性（含不可枚举的）：PostgrestError 的 message / details / hint / code
      // 有时挂在不被 JSON.stringify 默认序列化的位置上，只给一个 "{}"。
      const json = JSON.stringify(e, props);
      if (typeof json === 'string' && json !== '{}') return json;
    } catch {
      // 循环引用 / getter 抛错 → 落到下面的按字段摘录
    }
    const ctor = (e as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
    return `${ctor} ${excerpt(e, props)}`;
  }
  return String(e);
}

/** 逐个字段摘录（读不到的字段如实标出，不静默跳过）。 */
function excerpt(e: object, props: string[]): string {
  const rec = e as Record<string, unknown>;
  const parts = [];
  for (const k of props.slice(0, 8)) {
    if (k === 'stack') continue; // 堆栈太长，另有 lastSyncError 单独存
    let v: unknown;
    try {
      v = rec[k];
    } catch {
      v = '<读取抛错>';
    }
    parts.push(`${k}=${brief(v)}`);
  }
  if (props.length > 8) parts.push('…');
  return `{ ${parts.join(', ')} }`;
}

/** 值的简短描述：对象只报「构造器名 + 字段名」，避免把循环结构再展开一遍。 */
function brief(v: unknown): string {
  if (v === null || typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (v instanceof Error) return `Error(${v.message})`;
  const keys = Object.getOwnPropertyNames(v).slice(0, 6);
  const ctor = (v as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
  return `${ctor}{${keys.join(',')}}`;
}
