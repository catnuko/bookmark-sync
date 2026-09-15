// E2E：手动启动 Chrome → CDP 加载扩展 → Playwright connectOverCDP → 同步测试
import { chromium } from "playwright";
import { execSync, spawn } from "child_process";
import { rmSync, mkdirSync } from "fs";

const EXT_PATH = "D:\\code\\bookmark-sync\\extension";
const PROFILE = "D:\\code\\bookmark-sync\\.e2e-final";
const PORT = 9362;
const EMAIL = "346746061@qq.com";
const PASSWORD = "Qzy123456";
const PASSPHRASE = "123456789";
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

async function loadExtensionViaCDP(port, extPath) {
  const wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    ws.onopen = async () => {
      const mid = ++id;
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === mid) {
          ws.close();
          if (m.error) reject(new Error(JSON.stringify(m.error)));
          else resolve(m.result.id);
        }
      };
      ws.send(JSON.stringify({ id: mid, method: "Extensions.loadUnpacked", params: { path: extPath } }));
    };
    ws.onerror = reject;
  });
}

async function main() {
  // 1. 启动 Chrome
  console.log("=== 启动 Chrome ===");
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-extension",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--window-size=500,700",
  ], { detached: true, stdio: "ignore" });
  chrome.unref();
  await sleep(5000);

  // 2. CDP 加载扩展
  console.log("=== 加载扩展 ===");
  const extId = await loadExtensionViaCDP(PORT, EXT_PATH);
  console.log("扩展 ID:", extId);
  await sleep(2000);

  // 3. Playwright 连接
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  // 4. 打开 popup
  console.log("=== 打开 popup ===");
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await sleep(2000);
  await page.screenshot({ path: "./.e2e-01-popup.png" });
  const t1 = await page.textContent("body");
  console.log("popup 文本:", t1.substring(0, 150));

  // 5. 登录
  console.log("\n=== 登录 ===");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("#authSubmit");
  await sleep(5000);
  await page.screenshot({ path: "./.e2e-02-login.png" });
  const t2 = await page.textContent("body");
  console.log("登录后含'立即同步':", t2.includes("立即同步"), "含'口令':", t2.includes("口令"));

  // 6. 设置口令（如果有 onboard 引导）
  if (t2.includes("口令") && t2.includes("端到端")) {
    console.log("\n=== 设置口令 ===");
    const inputs = await page.locator('input[type="password"]').all();
    if (inputs.length > 0) {
      await inputs[0].fill(PASSPHRASE);
      const btns = await page.locator("button").all();
      for (const b of btns) {
        const txt = (await b.textContent()).trim();
        if (txt.includes("口令") || txt === "设置" || txt === "确认") { await b.click(); break; }
      }
      await sleep(2000);
      await page.screenshot({ path: "./.e2e-03-pass.png" });
      // 关闭可能的遮罩层（密钥确认/导入对话框）
      for (let attempt = 0; attempt < 3; attempt++) {
        const mask = await page.locator(".mask").first();
        if (await mask.isVisible().catch(() => false)) {
          const btns = await mask.locator("button").all();
          for (const b of btns) {
            const txt = (await b.textContent()).trim();
            if (txt.includes("确认") || txt.includes("知道") || txt.includes("关闭") || txt.includes("完成") || txt === "OK") {
              await b.click().catch(() => {});
              await sleep(500);
              break;
            }
          }
          // 如果没有按钮，按 Escape
          await page.keyboard.press("Escape").catch(() => {});
          await sleep(500);
        } else break;
      }
    }
  }

  // 7. 添加 3 个书签
  console.log("\n=== 添加 3 个书签 ===");
  await page.evaluate(async () => {
    await chrome.bookmarks.create({ title: "E2E-1", url: "https://e2e-1.example.com" });
    await chrome.bookmarks.create({ title: "E2E-2", url: "https://e2e-2.example.com" });
    await chrome.bookmarks.create({ title: "E2E-3", url: "https://e2e-3.example.com" });
  });
  await sleep(500);

  // 8. 同步
  console.log("\n=== 点击同步 ===");
  await page.reload();
  await sleep(1000);
  const before = await page.evaluate(async () => (await chrome.storage.local.get("lastSyncAt")).lastSyncAt);
  await page.click("#syncNow");
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const now = await page.evaluate(async () => (await chrome.storage.local.get("lastSyncAt")).lastSyncAt);
    if (now && now !== before) break;
  }
  await sleep(1000);
  await page.screenshot({ path: "./.e2e-04-sync.png" });
  const t3 = await page.textContent("body");
  console.log("同步后状态:", t3.substring(0, 400));

  // 9. 本地诊断
  const s = await page.evaluate(async () => await chrome.storage.local.get(null));
  console.log("\n=== 本地诊断 ===");
  console.log("lastSyncStatus:", s.lastSyncStatus);
  console.log("lastUsedReport:", JSON.stringify(s.lastUsedReport));
  console.log("lastDecryptErrors:", JSON.stringify(s.lastDecryptErrors));
  console.log("crdt.counter:", s["crdt.counter"]);
  console.log("crdt.afterId:", s["crdt.afterId"]);

  // 10. 数据库验证
  console.log("\n=== 数据库验证 ===");
  const opCount = db(`SELECT count(*)::int c FROM bsync_op_log WHERE space_id IN (SELECT id FROM bsync_spaces WHERE owner_id = '${UID}')`)[0].c;
  const profile = db(`SELECT used_count, e2ee_salt FROM bsync_profiles WHERE user_id = '${UID}'`)[0];
  console.log("op_log 条数:", opCount);
  console.log("used_count:", profile.used_count);
  console.log("e2ee_salt:", profile.e2ee_salt ? "(已设置)" : "(空)");

  // 11. 再次同步（验证幂等和额度稳定）
  console.log("\n=== 再次同步（验证额度不跳变）===");
  const before2 = await page.evaluate(async () => (await chrome.storage.local.get("lastSyncAt")).lastSyncAt);
  await page.click("#syncNow");
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const now = await page.evaluate(async () => (await chrome.storage.local.get("lastSyncAt")).lastSyncAt);
    if (now && now !== before2) break;
  }
  await sleep(1000);
  const profile2 = db(`SELECT used_count FROM bsync_profiles WHERE user_id = '${UID}'`)[0];
  console.log("第二次同步后 used_count:", profile2.used_count);
  const s2 = await page.evaluate(async () => (await chrome.storage.local.get("lastUsedReport")).lastUsedReport);
  console.log("第二次 lastUsedReport:", JSON.stringify(s2));

  console.log("\n=== 测试完成 ===");
  await browser.close();
  chrome.kill();
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
