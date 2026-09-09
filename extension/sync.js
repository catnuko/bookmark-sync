// 书签同步引擎 —— Chrome / Safari 通用（WebExtension 标准 API）
// 协议: 快照 diff + 版本号增量拉取 + 服务端按 URL 去重
//
// 防回环原理: 本轮先计算本地 diff 并推送，再把远端变更应用回本地、
// 同时更新快照——下轮 diff 时这些条目不再有差异，天然不会乒乓。

export const api = globalThis.chrome ?? globalThis.browser;

const STATE_KEY = "syncState"; // { lastVersion: number, snapshot: { [本地id]: {sid,url,title,folder} } }

// 读取整棵书签树，展平为 { [本地id]: {url, title, folder} }
async function readLocalTree() {
  const [root] = await api.bookmarks.getTree();
  const flat = {};
  const walk = (node, prefix) => {
    for (const child of node.children ?? []) {
      if (child.url) {
        flat[child.id] = { url: child.url, title: child.title ?? "", folder: prefix };
      } else {
        walk(child, prefix ? `${prefix}/${child.title ?? ""}` : (child.title ?? ""));
      }
    }
  };
  // 顶层根归一化: 第一个根 → BAR，其余 → OTHER（规避"书签栏/个人收藏"两端语言差异）
  const roots = root.children ?? [];
  roots.forEach((r, i) => walk(r, i === 0 ? "BAR" : "OTHER"));
  return flat;
}

// 确保本地存在对应文件夹路径（如 "BAR/技术/前端"），返回文件夹 id
async function ensureFolder(path) {
  const [root] = await api.bookmarks.getTree();
  const roots = root.children ?? [];
  if (!roots.length) return root.id;
  const parts = String(path).split("/").filter(Boolean);
  const rootIdx = parts[0] === "BAR" ? 0 : 1;
  let parentId = roots[Math.min(rootIdx, roots.length - 1)].id;
  for (const seg of parts.slice(1)) {
    const children = await api.bookmarks.getChildren(parentId);
    const found = children.find((c) => !c.url && c.title === seg);
    parentId = found ? found.id : (await api.bookmarks.create({ parentId, title: seg })).id;
  }
  return parentId;
}

// 本地当前树 vs 上次快照 → 新增 / 修改 / 删除
function diffTree(tree, snapshot) {
  const adds = [];
  const mods = [];
  const dels = [];
  for (const [lid, cur] of Object.entries(tree)) {
    const prev = snapshot[lid];
    if (!prev) {
      adds.push({ lid, ...cur });
    } else if (prev.url !== cur.url || prev.title !== cur.title || prev.folder !== cur.folder) {
      mods.push({ lid, sid: prev.sid, ...cur });
    }
  }
  for (const [lid, prev] of Object.entries(snapshot)) {
    if (!(lid in tree)) dels.push({ lid, sid: prev.sid });
  }
  return { adds, mods, dels };
}

export async function runSync() {
  const cfg = await api.storage.local.get(["serverUrl", "token"]);
  if (!cfg.serverUrl || !cfg.token) return { ok: false, reason: "未配置服务器地址或密钥" };

  const base = String(cfg.serverUrl).replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` };

  const stored = await api.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY] ?? { lastVersion: 0, snapshot: {} };
  const snapshot = state.snapshot;

  const tree = await readLocalTree();
  const { adds, mods, dels } = diffTree(tree, snapshot);

  // 1. 推送本地变更（新增排在最前，响应数组顺序与之一一对应）
  if (adds.length + mods.length + dels.length > 0) {
    const items = [
      ...adds.map((a) => ({ url: a.url, title: a.title, folder: a.folder, deleted: false })),
      ...mods.map((m) => ({ sid: m.sid, url: m.url, title: m.title, folder: m.folder, deleted: false })),
      ...dels.map((d) => ({ sid: d.sid, deleted: true })),
    ];
    const res = await fetch(`${base}/push`, {
      method: "POST",
      headers,
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(`push 失败: HTTP ${res.status}`);
    const data = await res.json();
    adds.forEach((a, i) => {
      snapshot[a.lid] = { sid: data.items[i].sid, url: a.url, title: a.title, folder: a.folder };
    });
    mods.forEach((m) => {
      snapshot[m.lid] = { sid: m.sid, url: m.url, title: m.title, folder: m.folder };
    });
    dels.forEach((d) => {
      delete snapshot[d.lid];
    });
  }

  // 2. 拉取远端变更并应用到本地
  const res = await fetch(`${base}/pull?since=${state.lastVersion}`, { headers });
  if (!res.ok) throw new Error(`pull 失败: HTTP ${res.status}`);
  const data = await res.json();

  const bySid = new Map(Object.entries(snapshot).map(([lid, v]) => [v.sid, lid]));

  for (const it of data.items) {
    const lid = bySid.get(it.sid);
    if (it.deleted) {
      if (lid !== undefined) {
        await api.bookmarks.remove(lid).catch(() => {});
        delete snapshot[lid];
        bySid.delete(it.sid);
      }
    } else if (lid !== undefined) {
      // 已有条目：仅在内容确实不同时才更新（自己刚推送的回显会在这里被跳过）
      const v = snapshot[lid];
      if (v.title !== it.title || v.url !== it.url) {
        await api.bookmarks.update(lid, { title: it.title, url: it.url });
      }
      if (v.folder !== it.folder) {
        await api.bookmarks.move(lid, { parentId: await ensureFolder(it.folder) });
      }
      snapshot[lid] = { sid: it.sid, url: it.url, title: it.title, folder: it.folder };
    } else {
      // 远端新条目：本地建文件夹路径 + 建书签
      const node = await api.bookmarks.create({
        parentId: await ensureFolder(it.folder),
        title: it.title,
        url: it.url,
      });
      snapshot[node.id] = { sid: it.sid, url: it.url, title: it.title, folder: it.folder };
      bySid.set(it.sid, node.id);
    }
  }

  await api.storage.local.set({ [STATE_KEY]: { lastVersion: data.version, snapshot } });
  return {
    ok: true,
    pushed: adds.length + mods.length + dels.length,
    pulled: data.items.length,
  };
}
