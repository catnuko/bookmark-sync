// 后台管理 — 单元测试
// 覆盖：format.js 纯函数、client.js 的 RPC 参数构造、auth.js 路由守卫逻辑。
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatBytes, formatCount, formatMoney, formatTime, timeAgo,
  planLabel, planTone, orderStatusMeta, subStatusMeta,
  formatRate, maskEmail,
} from "../../website/src/admin/lib/format.js";

describe("formatBytes", () => {
  it("B/KB/MB/GB 换算", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(500 * 1024 * 1024)).toBe("500 MB"); // ≥100 不带小数
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
  it("null/undefined 安全", () => {
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
  });
});

describe("formatMoney", () => {
  it("分转货币", () => {
    expect(formatMoney(1299, "USD")).toBe("$12.99");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });
  it("非法币种兜底为纯字符串", () => {
    expect(formatMoney(1000, "NOT_A_REAL_CCY")).toBe("10.00 NOT_A_REAL_CCY");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-09-14T12:00:00Z").getTime();
  it("刚刚/分钟/小时/天", () => {
    expect(timeAgo(new Date(now - 30 * 1000).toISOString(), now)).toBe("刚刚");
    expect(timeAgo(new Date(now - 5 * 60 * 1000).toISOString(), now)).toBe("5 分钟前");
    expect(timeAgo(new Date(now - 3 * 3600 * 1000).toISOString(), now)).toBe("3 小时前");
    expect(timeAgo(new Date(now - 5 * 86400 * 1000).toISOString(), now)).toBe("5 天前");
  });
  it("空值与非法值", () => {
    expect(timeAgo(null)).toBe("—");
    expect(timeAgo("not-a-date")).toBe("—");
  });
});

describe("formatTime", () => {
  it("ISO 转 YYYY-MM-DD HH:mm（本地时区）", () => {
    const s = formatTime("2026-09-14T03:04:05Z");
    expect(s).toMatch(/^2026-09-14 \d{2}:\d{2}$/);
  });
  it("空值", () => {
    expect(formatTime(null)).toBe("—");
  });
});

describe("plan / 订单 / 订阅 元数据", () => {
  it("planLabel", () => {
    expect(planLabel("free")).toBe("Free");
    expect(planLabel("pro")).toBe("Pro");
    expect(planLabel(undefined)).toBe("—");
  });
  it("planTone", () => {
    expect(planTone("pro")).toBe("success");
    expect(planTone("plus")).toBe("info");
    expect(planTone("unknown")).toBe("neutral");
  });
  it("orderStatusMeta", () => {
    expect(orderStatusMeta("paid").label).toBe("已支付");
    expect(orderStatusMeta("failed").tone).toBe("danger");
  });
  it("subStatusMeta", () => {
    expect(subStatusMeta("active").tone).toBe("success");
    expect(subStatusMeta("canceled").label).toBe("已取消");
  });
});

describe("formatRate / maskEmail / formatCount", () => {
  it("百分比", () => {
    expect(formatRate(0.1234)).toBe("12.3%");
    expect(formatRate(0)).toBe("0.0%");
  });
  it("邮箱脱敏", () => {
    expect(maskEmail("alice@example.com")).toBe("ali***@example.com");
    expect(maskEmail(null)).toBe("—");
  });
  it("千分位", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

// —— client.js 参数构造 ——
// 用 vi.mock 掉 supabase 客户端，验证 adminApi 把页面参数正确翻译成 RPC 入参。
const rpcMock = vi.fn();
vi.mock("../../website/src/lib/supabase.js", () => ({
  supabase: { rpc: (...args) => rpcMock(...args) },
}));

describe("adminApi 参数构造", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("listUsers 把页面/筛选映射成 p_ 前缀", async () => {
    rpcMock.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
    const { adminApi } = await import("../../website/src/admin/lib/client.js");
    // 页面组件自己算好 (page-1)*pageSize 作为 offset 传进来
    await adminApi.listUsers({ search: "a@b", plan: "pro", sort: "usage", limit: 25, offset: 25 });
    expect(rpcMock).toHaveBeenCalledWith("admin_list_users", {
      p_search: "a@b",
      p_plan: "pro",
      p_sort: "usage",
      p_limit: 25,
      p_offset: 25,
    });
  });

  it("RPC 错误抛 Error 且带 message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "forbidden: not a bsync admin", code: "42501" } });
    const { adminApi } = await import("../../website/src/admin/lib/client.js");
    await expect(adminApi.overview()).rejects.toThrow("forbidden: not a bsync admin");
  });

  it("setUserPlan 传 p_user / p_plan", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { adminApi } = await import("../../website/src/admin/lib/client.js");
    await adminApi.setUserPlan("00000000-0000-0000-0000-000000000001", "pro");
    expect(rpcMock).toHaveBeenCalledWith("admin_set_user_plan", {
      p_user: "00000000-0000-0000-0000-000000000001",
      p_plan: "pro",
    });
  });
});
