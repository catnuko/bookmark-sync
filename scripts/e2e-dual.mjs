// 双 Chrome 同步测试：A 加书签 → B 同步验证 → B 加书签 → A 同步验证
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
      const mid = 1;
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === mid) { ws.close(); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result.id); }
      };
      ws.send(JSON.stringify({ id: mid, method: "Extensions.loadUnpacked", params: { path: extPath } }));
    };
    ws.onerror = reject;
  });
}

function launchChrome(port, profile) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const p = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-extension",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=500,700",
  ], { detached: true, stdio: "ignore" });
  p.unref();
  return p;
}

async function openPopup(context, extId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await sleep(2000);
  return page;
}

async function login(page) {
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("#authSubmit");
  await sleep(5000);
}

async function closeMasks(page) {
  for (let i = 0; i < 5; i++) {
    const mask = page.locator(".mask").first();
    if (await mask.isVisible().catch(() => false)) {
      const btns = await mask.locator("button").all();
      let clicked = false;
      for (const b of btns) {
        const t = (await b.textContent()).trim();
        if (t.includes("确认") || t.includes("知道") || t.includes("关闭") || t.includes("完成") || t === "OK" || t.includes("跳过")) {
          await b.click().catch(() => {}); clicked = true; break;
        }
      }
      if (!clicked) await page.keyboard.press("Escape").catch(() => {});
      await sleep(500);
    } else break;
  }
}

async function syncNow(page) {
  const before = await page.evaluate(async () => (await chrome.storage.local.get("lastSyncAt")).lastSyncAt);
  await page.click("#syncNow");
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const now = await page.evaluate(async () => (await chrome.storage.local.get("lastSyncAt")).lastSyncAt);
    if (now && now !== before) break;
  }
  await sleep(1500);
}

async function getBookmarks(page) {
  return await page.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    const urls = [];
    const walk = (nodes) => { for (const n of nodes) { if (n.url) urls.push(n.url); if (n.children) walk(n.children); } };
    walk(tree);
    return urls;
  });
}

async function main() {
  console.log("=== 启动两个 Chrome ===");
  const chromeA = launchChrome(9401, "D:\\code\\bookmark-sync\\.e2e-A");
  const chromeB = launchChrome(9402, "D:\\code\\bookmark-sync\\.e2e-B");
  await sleep(5000);

  console.log("=== 加载扩展 ===");
  const extIdA = await loadExtension(9401, EXT_PATH);
  const extIdB = await loadExtension(9402, EXT_PATH);
  console.log("A 扩展 ID:", extIdA);
  console.log("B 扩展 ID:", extIdB);
  await sleep(2000);

  const browserA = await chromium.connectOverCDP("http://127.0.0.1:9401");
  const browserB = await chromium.connectOverCDP("http://127.0.0.1:9402");
  const ctxA = browserA.contexts()[0];
  const ctxB = browserB.contexts()[0];

  // ===== 设备 A：登录 + 先同步生成密钥 =====
  console.log("\n=== 设备 A：登录 ===");
  const pageA = await openPopup(ctxA, extIdA);
  await login(pageA);
  await closeMasks(pageA);
  await pageA.screenshot({ path: "./.e2e2-A-login.png" });

  // 先同步一次（自动生成 e2eeKey）
  console.log("=== 设备 A：首次同步（生成密钥）===");
  await pageA.reload(); await sleep(1000);
  await syncNow(pageA);
  console.log("A 首次同步状态:", await pageA.evaluate(async () => (await chrome.storage.local.get("lastSyncStatus")).lastSyncStatus));

  // 复制 e2eeKey（从 .key-text span 获取）
  console.log("=== 设备 A：复制同步密钥 ===");
  await pageA.click('text=同步密钥');
  await sleep(1000);
  const key = await pageA.evaluate(() => document.querySelector('.key-text')?.textContent || '');
  console.log("密钥完整值:", key); console.log("密钥长度:", key.length);
  if (!key || key.length < 10) throw new Error("设备 A 未获取到密钥: " + key);

  // 设备 A 添加书签
  console.log("\n=== 设备 A：添加 3 个书签 ===");
  await pageA.evaluate(async () => {
    await chrome.bookmarks.create({ title: "A-1", url: "https://a-1.example.com" });
    await chrome.bookmarks.create({ title: "A-2", url: "https://a-2.example.com" });
    await chrome.bookmarks.create({ title: "A-3", url: "https://a-3.example.com" });
  });
  await sleep(500);

  // 设备 A 同步
  console.log("=== 设备 A：同步 ===");
  await pageA.reload(); await sleep(1000);
  await syncNow(pageA);
  const statusA = await pageA.evaluate(async () => (await chrome.storage.local.get("lastSyncStatus")).lastSyncStatus);
  console.log("A 同步状态:", statusA);
  await pageA.screenshot({ path: "./.e2e2-A-sync.png" });

  // ===== 设备 B：登录 + 导入密钥 =====
  console.log("\n=== 设备 B：登录 ===");
  const pageB = await openPopup(ctxB, extIdB);
  await login(pageB);
  await sleep(2000);
  await pageB.screenshot({ path: "./.e2e2-B-login.png" });

  // 设备 B 导入密钥（轮询检测引导页 mask）
  console.log("=== 设备 B：导入同步密钥 ===");
  let imported = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const mask = pageB.locator(".mask").first();
    if (await mask.isVisible().catch(() => false)) {
      // 引导页：在 mask 内找到密钥输入框（placeholder 含"从其他设备"）
      const input = mask.locator('input[placeholder*="从其他设备"]').first();
      if (await input.isVisible().catch(() => false)) {
        await input.fill(key);
        await sleep(300);
        const importBtn = mask.locator('button.btn-solid').first();
        await importBtn.click();
        await sleep(2000);
        imported = true;
        break;
      }
    }
    await sleep(1000);
  }
  if (!imported) {
    // 没有引导页，去同步密钥 tab 导入
    console.log("  无引导页，走同步密钥 tab");
    await pageB.click('text=同步密钥');
    await sleep(1000);
    const importInput = pageB.locator('input[placeholder="粘贴密钥（新设备导入）"]');
    await importInput.fill(key);
    await sleep(300);
    await pageB.click('button:has-text("导入")');
    await sleep(2000);
  }
  await closeMasks(pageB);
  await pageB.screenshot({ path: "./.e2e2-B-import.png" });

  // 诊断：对比设备 A 导出的密钥和设备 B storage 中的密钥
  const bKeyInStorage = await pageB.evaluate(async () => (await chrome.storage.local.get("crdt.e2eeKey"))["crdt.e2eeKey"]);
  console.log("  A 导出密钥:", key.substring(0, 20) + "...");
  console.log("  B storage 密钥:", bKeyInStorage?.substring(0, 20) + "...");
  console.log("  密钥匹配:", key === bKeyInStorage);

  // 设备 B 同步
  console.log("=== 设备 B：同步（应拉取 A 的 3 个书签）===");
  await pageB.reload(); await sleep(1000);
  await syncNow(pageB);
  const statusB = await pageB.evaluate(async () => (await chrome.storage.local.get("lastSyncStatus")).lastSyncStatus);
  console.log("B 同步状态:", statusB);
  const bDiag = await pageB.evaluate(async () => {
    const s = await chrome.storage.local.get(null);
    return { lastDecryptErrors: s.lastDecryptErrors, lastSyncError: s.lastSyncError, e2eeKey: s["crdt.e2eeKey"]?.substring(0, 20) };
  });
  console.log("B 解密错误详情:", JSON.stringify(bDiag.lastDecryptErrors));
  console.log("B 同步错误:", bDiag.lastSyncError);
  await pageB.screenshot({ path: "./.e2e2-B-sync.png" });

  // 验证 B 中是否有 A 的书签
  const bookmarksB = await getBookmarks(pageB);
  console.log("\n=== 验证：设备 B 的书签 ===");
  console.log("B 书签列表:", bookmarksB);
  const hasA1 = bookmarksB.some(u => u.includes("a-1.example.com"));
  const hasA2 = bookmarksB.some(u => u.includes("a-2.example.com"));
  const hasA3 = bookmarksB.some(u => u.includes("a-3.example.com"));
  console.log("B 有 A-1:", hasA1, "A-2:", hasA2, "A-3:", hasA3);

  // ===== 反向：设备 B 添加书签，设备 A 同步验证 =====
  console.log("\n=== 设备 B：添加 2 个书签 ===");
  await pageB.evaluate(async () => {
    await chrome.bookmarks.create({ title: "B-1", url: "https://b-1.example.com" });
    await chrome.bookmarks.create({ title: "B-2", url: "https://b-2.example.com" });
  });
  await sleep(500);
  await syncNow(pageB);
  console.log("B 第二次同步状态:", await pageB.evaluate(async () => (await chrome.storage.local.get("lastSyncStatus")).lastSyncStatus));

  console.log("\n=== 设备 A：再次同步（应拉取 B 的 2 个书签）===");
  await pageA.bringToFront();
  await pageA.reload(); await sleep(1000);
  await syncNow(pageA);
  const bookmarksA = await getBookmarks(pageA);
  console.log("A 书签列表:", bookmarksA);
  const hasB1 = bookmarksA.some(u => u.includes("b-1.example.com"));
  const hasB2 = bookmarksA.some(u => u.includes("b-2.example.com"));
  console.log("A 有 B-1:", hasB1, "B-2:", hasB2);

  // 数据库验证
  console.log("\n=== 数据库验证 ===");
  const opCount = db(`SELECT count(*)::int c FROM bsync_op_log WHERE space_id IN (SELECT id FROM bsync_spaces WHERE owner_id = '${UID}')`)[0].c;
  const profile = db(`SELECT used_count FROM bsync_profiles WHERE user_id = '${UID}'`)[0];
  const devices = db(`SELECT count(*)::int c FROM bsync_devices WHERE space_id IN (SELECT id FROM bsync_spaces WHERE owner_id = '${UID}')`)[0].c;
  console.log("op_log:", opCount, "used_count:", profile.used_count, "devices:", devices);

  // 总结
  console.log("\n========== 测试结果 ==========");
  const allPass = hasA1 && hasA2 && hasA3 && hasB1 && hasB2;
  console.log("A→B 同步（3条）:", hasA1 && hasA2 && hasA3 ? "PASS" : "FAIL");
  console.log("B→A 同步（2条）:", hasB1 && hasB2 ? "PASS" : "FAIL");
  console.log("数据库 op_log:", opCount, "（预期≥5）");
  console.log("devices 注册:", devices, "（预期=2）");
  console.log("总体:", allPass ? "ALL PASS" : "HAS FAILURES");

  await browserA.close();
  await browserB.close();
  chromeA.kill();
  chromeB.kill();
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
