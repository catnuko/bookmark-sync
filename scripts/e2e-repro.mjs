// 复现用户场景：A加书签同步→B导入密钥同步→B额度变0？
import { chromium } from "playwright";
import { spawn } from "child_process";
import { rmSync, mkdirSync } from "fs";

const EXT_PATH = "D:\\code\\bookmark-sync\\extension";
const EMAIL = "346746061@qq.com";
const PASSWORD = "Qzy123456";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadExtension(port, extPath) {
  const wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === 1) { ws.close(); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result.id); }
      };
      ws.send(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: extPath } }));
    };
    ws.onerror = reject;
  });
}

function launchChrome(port, profile) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const p = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-extension", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "--window-size=500,700",
  ], { detached: true, stdio: "ignore" });
  p.unref();
  return p;
}

async function doSync(page) {
  const before = await page.evaluate(async () => (await chrome.storage.local.get("lastSyncAt")).lastSyncAt);
  await page.click("#syncNow");
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const now = await page.evaluate(async () => (await chrome.storage.local.get("lastSyncAt")).lastSyncAt);
    if (now && now !== before) break;
  }
  await sleep(2000);
  return await page.evaluate(async () => (await chrome.storage.local.get("lastSyncStatus")).lastSyncStatus);
}

async function getSwLogs(port) {
  // 通过 CDP 获取 SW 的 console 日志
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const sw = targets.find(t => t.type === "service_worker" && t.url.includes("background.js"));
  if (!sw) return "SW not found in CDP targets";
  const wsUrl = sw.webSocketDebuggerUrl;
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const logs = [];
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
      // 等 2 秒收集日志
      setTimeout(() => { ws.close(); resolve(logs.join("\n")); }, 2000);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.consoleAPICalled") {
        const args = m.params.args.map(a => a.value ?? a.description ?? "").join(" ");
        if (args.includes("[bsync]") || args.includes("logBridge")) logs.push(args);
      }
      if (m.method === "Log.entryAdded") {
        const txt = m.params.entry.text;
        if (txt.includes("[bsync]") || txt.includes("logBridge")) logs.push(txt);
      }
    };
    ws.onerror = () => resolve("WS error");
  });
}

async function main() {
  const chromeA = launchChrome(9420, "D:\\code\\bookmark-sync\\.e2e-A3");
  const chromeB = launchChrome(9421, "D:\\code\\bookmark-sync\\.e2e-B3");
  await sleep(5000);
  const extIdA = await loadExtension(9420, EXT_PATH);
  const extIdB = await loadExtension(9421, EXT_PATH);
  const browserA = await chromium.connectOverCDP("http://127.0.0.1:9420");
  const browserB = await chromium.connectOverCDP("http://127.0.0.1:9421");

  // === 设备 A：登录 + 加 1 书签 + 同步 ===
  console.log("=== 设备 A：登录 + 加 1 书签 + 同步 ===");
  const pageA = await browserA.contexts()[0].newPage();
  await pageA.goto(`chrome-extension://${extIdA}/popup.html`);
  await sleep(2000);
  await pageA.fill("#email", EMAIL);
  await pageA.fill("#password", PASSWORD);
  await pageA.click("#authSubmit");
  await sleep(5000);
  for (let i = 0; i < 5; i++) {
    const mask = pageA.locator(".mask").first();
    if (await mask.isVisible().catch(() => false)) { await pageA.keyboard.press("Escape"); await sleep(500); } else break;
  }
  await pageA.evaluate(async () => {
    await chrome.bookmarks.create({ title: "测试书签A", url: "https://test-a.example.com" });
  });
  await sleep(2000);
  await pageA.reload(); await sleep(1000);
  const statusA = await doSync(pageA);
  console.log("A 同步状态:", statusA);

  // 检查 A 的额度
  const profileA = await pageA.evaluate(async () => {
    const { data } = await (await fetch("https://cwtqnsbpcetvqopdkcou.supabase.co/rest/v1/bsync_profiles?select=used_count", {
      headers: { "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3dHFuc2iwY2V0dnFvcGRrY291Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjYwOTYwMDAsImV4cCI6MjA0MTY3MjAwMH0.fake", "Authorization": "Bearer fake" }
    })).json();
    return data;
  }).catch(() => "cannot fetch");

  // 复制 A 的密钥
  await pageA.click('text=同步密钥'); await sleep(500);
  const keyA = await pageA.evaluate(() => document.querySelector('.key-text')?.textContent || '');
  console.log("A 密钥:", keyA);
  const bookmarksA = await pageA.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const urls = [];
    const walk = (nodes) => { for (const n of nodes) { if (n.url) urls.push(n.url); if (n.children) walk(n.children); } };
    walk(tree);
    return urls;
  });
  console.log("A 书签:", bookmarksA);

  // === 设备 B：登录 + 导入密钥 + 同步 ===
  console.log("\n=== 设备 B：登录 + 导入密钥 + 同步 ===");
  const pageB = await browserB.contexts()[0].newPage();
  await pageB.goto(`chrome-extension://${extIdB}/popup.html`);
  await sleep(2000);
  await pageB.fill("#email", EMAIL);
  await pageB.fill("#password", PASSWORD);
  await pageB.click("#authSubmit");
  await sleep(5000);
  for (let i = 0; i < 5; i++) {
    const mask = pageB.locator(".mask").first();
    if (await mask.isVisible().catch(() => false)) { await pageB.keyboard.press("Escape"); await sleep(500); } else break;
  }
  // 导入密钥
  await pageB.click('text=同步密钥'); await sleep(500);
  await pageB.fill('input[placeholder="粘贴密钥（新设备导入）"]', keyA);
  await sleep(300);
  await pageB.click('button:has-text("导入")');
  await sleep(2000);
  console.log("B 密钥导入完成");

  // B 同步
  await pageB.reload(); await sleep(1000);
  const statusB = await doSync(pageB);
  console.log("B 同步状态:", statusB);

  // 检查 B 的书签
  const bookmarksB = await pageB.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const urls = [];
    const walk = (nodes) => { for (const n of nodes) { if (n.url) urls.push(n.url); if (n.children) walk(n.children); } };
    walk(tree);
    return urls;
  });
  console.log("B 书签:", bookmarksB);

  // 检查 B 的额度显示
  const quotaTextB = await pageB.evaluate(() => document.body.innerText.match(/(\d+)\s*\/\s*500/)?.[0] || "not found");
  console.log("B 额度显示:", quotaTextB);

  // 捕获 B 的 SW 日志
  console.log("\n=== 设备 B SW 日志（最近的 [bsync]）===");
  const swLogs = await getSwLogs(9421);
  console.log(swLogs);

  // 数据库验证
  console.log("\n=== 数据库验证 ===");
  const { execSync } = await import("child_process");
  const pat = "sbp_fcf98872fbc66d31e8f5d3f251fa6b4ad499f303";
  const ref = "cwtqnsbpcetvqopdkcou";
  const uid = "86ac8706-41f5-4129-b579-734a73e91486";
  const result = JSON.parse(execSync(`curl -s -X POST "https://api.supabase.com/v1/projects/${ref}/database/query" -H "Authorization: Bearer ${pat}" -H "Content-Type: application/json" -d "{\\\"query\\\":\\\"SELECT id, seq, device_id, length(op) as op_len FROM bsync_op_log WHERE space_id IN (SELECT id FROM bsync_spaces WHERE owner_id = '${uid}') ORDER BY id\\\"}"`, { encoding: "utf8" }));
  console.log("op_log 行数:", result.length);
  result.forEach(r => console.log(`  #${r.id} seq=${r.seq} device=${r.device_id} op_len=${r.op_len}`));
  const profile = JSON.parse(execSync(`curl -s -X POST "https://api.supabase.com/v1/projects/${ref}/database/query" -H "Authorization: Bearer ${pat}" -H "Content-Type: application/json" -d "{\\\"query\\\":\\\"SELECT used_count FROM bsync_profiles WHERE user_id = '${uid}'\\\"}"`, { encoding: "utf8" }));
  console.log("云端 used_count:", profile[0]?.used_count);

  await browserA.close();
  await browserB.close();
  chromeA.kill();
  chromeB.kill();
  process.exit(0);
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
