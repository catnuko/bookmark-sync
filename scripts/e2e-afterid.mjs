// 复现：新设备先同步（密钥错误）→ afterId 被推进 → 导入密钥 → 再同步拉取 0
import { chromium } from "playwright";
import { execSync, spawn } from "child_process";
import { rmSync, mkdirSync } from "fs";

const EXT_PATH = "D:\\code\\bookmark-sync\\extension";
const EMAIL = "346746061@qq.com";
const PASSWORD = "Qzy123456";
const PAT = "sbp_fcf98872fbc66d31e8f5d3f251fa6b4ad499f303";
const REF = "cwtqnsbpcetvqopdkcou";
const UID = "86ac8706-41f5-4129-b579-734a73e91486";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function db(sql) {
  const body = JSON.stringify({ query: sql });
  const out = execSync(
    `curl -s -X POST "https://api.supabase.com/v1/projects/${REF}/database/query" -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" -d ${JSON.stringify(body)}`,
    { encoding: "utf8" }
  );
  return JSON.parse(out);
}

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
  await sleep(1500);
  return await page.evaluate(async () => (await chrome.storage.local.get("lastSyncStatus")).lastSyncStatus);
}

async function main() {
  const chromeA = launchChrome(9410, "D:\\code\\bookmark-sync\\.e2e-A2");
  const chromeB = launchChrome(9411, "D:\\code\\bookmark-sync\\.e2e-B2");
  await sleep(5000);
  const extIdA = await loadExtension(9410, EXT_PATH);
  const extIdB = await loadExtension(9411, EXT_PATH);
  const browserA = await chromium.connectOverCDP("http://127.0.0.1:9410");
  const browserB = await chromium.connectOverCDP("http://127.0.0.1:9411");

  // 设备 A：登录 + 加书签 + 同步
  console.log("=== 设备 A：登录 + 加 2 书签 + 同步 ===");
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
    await chrome.bookmarks.create({ title: "R-1", url: "https://r-1.example.com" });
    await chrome.bookmarks.create({ title: "R-2", url: "https://r-2.example.com" });
  });
  await sleep(2000);
  await pageA.reload(); await sleep(1000);
  console.log("A 同步:", await doSync(pageA));

  // 导出密钥
  await pageA.click('text=同步密钥'); await sleep(1000);
  const key = await pageA.evaluate(() => document.querySelector('.key-text')?.textContent || '');
  console.log("A 密钥:", key.substring(0, 15) + "...");

  // 设备 B：登录（不导入密钥）→ 同步（应解密失败）
  console.log("\n=== 设备 B：登录（不导入密钥）→ 同步 ===");
  const pageB = await browserB.contexts()[0].newPage();
  await pageB.goto(`chrome-extension://${extIdB}/popup.html`);
  await sleep(2000);
  await pageB.fill("#email", EMAIL);
  await pageB.fill("#password", PASSWORD);
  await pageB.click("#authSubmit");
  await sleep(5000);
  // 关闭引导页（跳过，不导入密钥）
  for (let i = 0; i < 5; i++) {
    const mask = pageB.locator(".mask").first();
    if (await mask.isVisible().catch(() => false)) {
      const skipBtn = mask.locator('button:has-text("跳过")');
      if (await skipBtn.count() > 0) { await skipBtn.first().click(); }
      else { await pageB.keyboard.press("Escape"); }
      await sleep(500);
    } else break;
  }
  await pageB.reload(); await sleep(1000);
  const statusB1 = await doSync(pageB);
  console.log("B 第一次同步（无密钥）:", statusB1);
  const afterIdB1 = await pageB.evaluate(async () => (await chrome.storage.local.get("crdt.afterId"))["crdt.afterId"]);
  console.log("B afterId（应被推进）:", afterIdB1);

  // 设备 B：导入密钥
  console.log("\n=== 设备 B：导入密钥 ===");
  await pageB.click('text=同步密钥'); await sleep(500);
  await pageB.fill('input[placeholder="粘贴密钥（新设备导入）"]', key);
  await sleep(300);
  await pageB.click('button:has-text("导入")');
  await sleep(2000);
  const afterIdB2 = await pageB.evaluate(async () => (await chrome.storage.local.get("crdt.afterId"))["crdt.afterId"]);
  console.log("B afterId（导入后应被清空）:", afterIdB2 ?? "(空)");

  // 设备 B：再次同步（应拉取到 2 条）
  console.log("\n=== 设备 B：再次同步（应拉取 2 条）===");
  await pageB.reload(); await sleep(1000);
  const statusB2 = await doSync(pageB);
  console.log("B 第二次同步:", statusB2);

  const bookmarksB = await pageB.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const urls = [];
    const walk = (nodes) => { for (const n of nodes) { if (n.url) urls.push(n.url); if (n.children) walk(n.children); } };
    walk(tree);
    return urls;
  });
  console.log("B 书签:", bookmarksB);
  const hasR1 = bookmarksB.some(u => u.includes("r-1"));
  const hasR2 = bookmarksB.some(u => u.includes("r-2"));
  console.log("B 有 R-1:", hasR1, "R-2:", hasR2);

  // 数据库验证
  const profile = db(`SELECT used_count FROM bsync_profiles WHERE user_id = '${UID}'`)[0];
  console.log("\n云端 used_count:", profile.used_count, "(应为 2)");

  console.log("\n========== 结果 ==========");
  console.log("B 拉取到书签:", hasR1 && hasR2 ? "PASS" : "FAIL");
  console.log("云端额度正确:", profile.used_count === 2 ? "PASS" : "FAIL");

  await browserA.close();
  await browserB.close();
  chromeA.kill();
  chromeB.kill();
  process.exit(hasR1 && hasR2 && profile.used_count === 2 ? 0 : 1);
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
