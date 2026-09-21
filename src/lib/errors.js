/**
 * src/lib/errors.js — 把「抛出的东西」变成可读字符串。
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
 */
export function describeError(e) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    try {
      // 带上 own 属性（含不可枚举的）：PostgrestError 的 message / details / hint / code
      // 有时挂在不被 JSON.stringify 默认序列化的位置上，只给一个 "{}"。
      return JSON.stringify(e, Object.getOwnPropertyNames(e));
    } catch {
      // 循环引用等导致 stringify 失败时，至少留下类型信息
      return Object.prototype.toString.call(e);
    }
  }
  return String(e);
}
