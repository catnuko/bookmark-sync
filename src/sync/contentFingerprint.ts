/**
 * 跨设备一致的内容指纹（「内容认领」轮，2026-10-01）。
 *
 * 背景：节点身份在本机是**随机 uuid**（`chromeBridge` 捕获时 `randomUUID()`），
 * 而 `chromeId↔uuid` 映射表只存本机。于是同一条逻辑书签在不同设备 / 不同登录态
 * 下会被赋予互不相干的 uuid → CRDT 里并列出两份（跨设备翻倍 / 登录态切换重复）。
 *
 * 修法不是把 id 改成内容寻址（那会把「移动 / 改名」变成换身份），而是**让身份可
 * 按内容被认领**：捕获一个未映射的 chrome 节点时，先看 CRDT 里是否已有同内容的
 * 节点，有就沿用它的 uuid，而不是新建一个。
 *
 * 指纹必须是**跨设备一致**的，所以只能由「收敛后的值」构成：
 *   - `parentUuid`：固定根 / 已收敛节点的 uuid，各设备一致；
 *   - 节点类型（书签 vs 文件夹，由有无 url 判定）；
 *   - `title` / `url`：LWW 收敛后的值。
 * **不含** chromeId、本机 uuid、position/index —— 那些是本机局部的，会让指纹漂移。
 *
 * 顺序无关：同内容不同顺序不改变键（两条一模一样的书签由调用方按候选消费顺序
 * 区分，见 captureLocalTree）。
 *
 * 用**规范字符串**（而非哈希）作为索引键：碰撞为零、同步、易测；它只用作内存
 * 索引的键，不需要落盘。
 */

/** 字段分隔符：U+001F（Unit Separator），书签标题 / URL 里不会出现。 */
const SEP = '\u001f';

/**
 * 计算内容指纹。同一父节点下、同类型、同标题、同 URL 的节点得到同一键。
 *
 * @param parentUuid 该节点在 CRDT 里的父节点 uuid（固定根或已收敛节点）。
 * @param meta       节点的 title / url（url 为空即文件夹）。
 */
export function contentKey(parentUuid: string, meta: { title?: string; url?: string }): string {
  const url = meta.url ?? '';
  const kind = url ? 'b' : 'f';
  return `${parentUuid}${SEP}${kind}${SEP}${meta.title ?? ''}${SEP}${url}`;
}
