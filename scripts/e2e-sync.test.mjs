// Playwright E2E 测试：bookmark-sync 扩展同步流程
// 用法: node scripts/e2e-sync.test.mjs
import { chromium } from "playwright";
import { execSync } from "child_process";

const EXTENSION_PATH = "D:\\code\\bookmark-sync\\extension";
const TEST_EMAIL = "346746061@qq.com";
const TEST_PASSWORD = "Qzy123456";
const TEST_PASSPHRASE = "123456789";
const SUPABASE_PAT = "sbp_fcf98872fbc66d31e8f5d3f251fa6b4ad499f303";
const SUPABASE_REF = "cwtqnsbpcetvqopdkcou";

function dbQuery(sql) {
  const body = JSON.stringify({ query: sql });
  const out = execSync(
    `curl -s -X POST "https://api.supabase.com/v1/projects/${SUPABASE_REF}/database/query" ` +
    `-H "Authorization: Bearer ${SUPABASE_PAT}" -H "Content-Type: application/json" -d ${JSON.stringify(body)}`,
    { encoding: "utf8" }
  );
  return JSON.parse(out);
}

async function getExtensionId(context) {
  // 从扩展的 background service worker 页面获取 ID
  const page = await context.newPage();
  await page.goto("chrome://extensions/");
  await await sleep(1500);
  // 扩展卡片中的 ID
  const id = await page.evaluate(() => {
    const cards = document.querySelectorAll("extensions-item");
    for (const card of cards) {
      const name = card.shadowRoot?.querySelector("#name")?.textContent;
      if (name?.includes("Bookmark Sync")) {
        return card.shadowRoot.querySelector("#id")?.textContent?.trim();
      }
    }
    return null;
  });
  await page.close();
  return id;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log("=== 1. 启动 Chrome 并加载扩展 ===");
  const context = await chromium.launchPersistentContext("./.e2e-profile", {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    viewport: { width: 1280, height: 800 },
  });

  // 等待扩展加载
  await await sleep(2000);

  console.log("=== 2. 获取扩展 ID ===");
  const extId = await getExtensionId(context);
  console.log("扩展 ID:", extId);
  if (!extId) throw new Error("未找到扩展");

  const popupUrl = `chrome-extension://${extId}/popup.html`;

  console.log("=== 3. 打开 popup 并登录 ===");
  const page = await context.newPage();
  await page.goto(popupUrl);
  await await sleep(1000);

  // 截图初始状态
  await page.screenshot({ path: "./.e2e-01-login.png" });

  // 输入邮箱密码
  await page.fill('input[type="email"], input[placeholder*="邮箱"], input#email', TEST_EMAIL);
  await page.fill('input[type="password"], input[placeholder*="密码"]', TEST_PASSWORD);
  await page.screenshot({ path: "./.e2e-02-filled.png" });

  // 点击登录按钮
  await page.click('button:has-text("登录"), button[type="submit"]');
  await await sleep(3000);
  await page.screenshot({ path: "./.e2e-03-after-login.png" });

  // 检查是否登录成功（看是否有同步按钮或 onboard 引导）
  const pageText = await page.textContent("body");
  console.log("登录后页面包含 '立即同步':", pageText.includes("立即同步"));
  console.log("登录后页面包含 '口令':", pageText.includes("口令"));

  console.log("=== 4. 检查本地存储状态 ===");
  const storage = await page.evaluate(async () => {
    return await chrome.storage.local.get(null);
  });
  console.log("storage keys:", Object.keys(storage));
  console.log("has e2eeKey:", !!storage["crdt.e2eeKey"]);
  console.log("has e2eeSalt:", !!storage["crdt.e2eeSalt"]);

  // 如果有 onboard 引导，设置口令
  if (pageText.includes("口令") || pageText.includes("密钥")) {
    console.log("=== 4b. 设置口令 ===");
    // 尝试找到口令输入框
    const phraseInputs = await page.locator('input[type="password"]').all();
    console.log("找到密码输入框数量:", phraseInputs.length);
    if (phraseInputs.length > 0) {
      await phraseInputs[0].fill(TEST_PASSPHRASE);
      // 点击设置口令按钮
      await page.click('button:has-text("口令"), button:has-text("设置"), button:has-text("确认")').catch(() => {});
      await await sleep(2000);
      await page.screenshot({ path: "./.e2e-04-passphrase.png" });
    }
  }

  console.log("=== 5. 添加测试书签 ===");
  // 通过扩展页面上下文调用 chrome.bookmarks API
  await page.evaluate(async () => {
    await chrome.bookmarks.create({ title: "测试书签1", url: "https://example.com/1" });
    await chrome.bookmarks.create({ title: "测试书签2", url: "https://example.com/2" });
    await chrome.bookmarks.create({ title: "测试书签3", url: "https://example.com/3" });
  });
  await await sleep(500);
  const bookmarkCount = await page.evaluate(async () => {
    const tree = await chrome.bookmarks.getTree();
    function count(nodes) {
      let c = 0;
      for (const n of nodes) {
        if (n.url) c++;
        if (n.children) c += count(n.children);
      }
      return c;
    }
    return count(tree);
  });
  console.log("当前书签总数:", bookmarkCount);

  console.log("=== 6. 点击立即同步 ===");
  // 重新打开 popup（确保状态最新）
  await page.reload();
  await await sleep(1000);
  await page.screenshot({ path: "./.e2e-05-before-sync.png" });

  await page.click('button:has-text("立即同步")');
  await await sleep(5000);
  await page.screenshot({ path: "./.e2e-06-after-sync.png" });

  const statusText = await page.textContent("body");
  console.log("同步后状态文本:", statusText.substring(0, 300));

  console.log("=== 7. 检查本地存储诊断字段 ===");
  const storageAfter = await page.evaluate(async () => {
    return await chrome.storage.local.get(null);
  });
  console.log("lastSyncStatus:", storageAfter.lastSyncStatus);
  console.log("lastSyncAt:", storageAfter.lastSyncAt ? new Date(storageAfter.lastSyncAt).toLocaleString() : "none");
  console.log("lastUsedReport:", JSON.stringify(storageAfter.lastUsedReport));
  console.log("lastDecryptErrors:", JSON.stringify(storageAfter.lastDecryptErrors));
  console.log("crdt.counter:", storageAfter["crdt.counter"]);
  console.log("crdt.afterId:", storageAfter["crdt.afterId"]);

  console.log("=== 8. 查询数据库验证 ===");
  const uid = "86ac8706-41f5-4129-b579-734a73e91486";
  const opCount = dbQuery(`SELECT count(*)::int as c FROM public.bsync_op_log WHERE space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = '${uid}');`);
  console.log("op_log 条数:", opCount[0]?.c);

  const profile = dbQuery(`SELECT used_count, used_bytes, e2ee_salt FROM public.bsync_profiles WHERE user_id = '${uid}';`);
  console.log("profile:", JSON.stringify(profile[0]));

  const ops = dbQuery(`SELECT id, device_id, seq FROM public.bsync_op_log WHERE space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = '${uid}') ORDER BY id;`);
  console.log("op_log 详情:", JSON.stringify(ops));

  console.log("\n=== 测试完成 ===");
  console.log("截图保存在 .e2e-*.png");

  await context.close();
}

main().catch((e) => {
  console.error("测试失败:", e);
  process.exit(1);
});
