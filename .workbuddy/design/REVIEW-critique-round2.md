# 质量审查报告（第二轮复验）· Bookmark Sync 原型
审查人：严过审（Yan）｜对象：`bookmark-sync-ui-prototype.html`（1324 行 / 121,656 B，v1.1）
方法：grep 全文扫描 + node 对比度实算（cjs）+ CSS 尺寸推导 + `node --check`。全程只读。
上一轮结论：19/25、1 项 P0 阻断。本轮为 P0/P1/P2 修订后的独立复验。

---

## A. 逐条核验表（实测值均为数字）

| # | 它声称 | 实测方法 | 实测值 | 判定 |
|---|--------|----------|--------|------|
| 1 | `--text-on-inset` 浅 `#5f5f5f` on `#ececea` = 5.40；深 `#c7c7cc` on `#2c2c2e` = 8.28；替换 badge-neutral / seg 未选中 / kbd | node `cr()`；grep L31/77/175/189/363 | **5.40** / **8.28** | ✅ 通过（数值完全一致） |
| 2 | `.cell-cap .idx`、`.opt-addr .url` 也改 on-inset | grep L342 / L307 | 两处均 `color:var(--text-on-inset)` = **5.40** | ✅ 通过 |
| 3a | `.sc-tail` tertiary→secondary，原 4.20 改 4.64 | node；grep L256 | 新 **4.64**；原 `#767676` on `#f6f6f4` = **4.20** | ✅ 通过 |
| 3b | `.statuscard.error .sc-s` 改 `--text-on-tint #0a0a0a`，原 4.40 改 17.32 | node；grep L261 | 新 **17.32**；原 `#6f6f6f` on `#FDECEB` = **4.40** | ✅ 通过（但过度，见 B-1） |
| 3c | §3 行内改名提示 tertiary→secondary | grep L767 | `color:var(--text-secondary)` = **4.64** | ✅ 通过 |
| 3d | 页脚 2 处装饰 `·` + footer tertiary→secondary，原 4.17 改 4.61 | grep L1218/1220/1222；node | 全 `--text-secondary` = **4.61**；原 `#767676` on `#f5f5f7` = **4.17** | ✅ 通过 |
| 4 | 触控全 44：seg 30→32、switch `-9px 0`、pill `-9px 0`、link-btn padding 8 | CSS 尺寸推导（L188/198/184/269 + L144） | seg 32+12=**44**；switch 26+18=**44**；pill 26+18=**44**；link-btn(8+16+8=32)+12=**44** | ✅ 通过（4/4 = 44） |
| 5 | link-btn 14×span→button；8×div 补 role=button+tabindex；Enter/Space JS；seg 3 tablist/6 tab | grep + 读 JS | `<button type=button class=link-btn>`=**14**、残留 span=**0**；`role="button" tabindex="0"`=**8**；keydown 处理=**1**(Enter/` `/Spacebar→click，L1261-1266)；`role="tablist"`=**3**、`role="tab"`=**6** | ✅ 通过（ARIA 语义见 B-2） |
| 6 | `.note`/`.no`/`footer`→secondary | grep L131/125/1218 | 三处 `--text-secondary` = **4.61**（on `#f5f5f7`） | ✅ 通过 |
| 7 | 裸 `border-radius` 数值 0 条；新增 `--radius-2xl:14px` | grep `border-radius:[0-9]+px` | **0** 条；`--radius-2xl:14px` 已加(L42)，用 2 次 | ✅ 通过（命名见 C-1） |
| 8 | stroke-width 95 SVG 全 1.75；帮助 6 条；禁用走令牌；focus-visible 删 radius | grep 计数 | SVG=**95**、`1.75`=**95**、`2`=**0**、`1.5`=**0**；acc-item=**6**（含"空间与设备简述"）；`.btn[disabled]` 走令牌(L158)；`:focus-visible{box-shadow:var(--focus-ring)}`(L97) | ✅ 通过（0 例外） |
| 9 | 无回归：首屏不滚 / 零依赖 / 深色完整 / JS 语法 | CSS 预算 + grep + `node --check` | 7 屏预算 **409 / 409 / 409 / 342 / 409 / 454 / 486** ≤ 572；外链=**0**；深色含新令牌；`node --check rc=0` | ✅ 通过 |

---

## B. 新引入问题的判定

### B-1 ｜ `--text-on-tint` 用 `#0a0a0a` —— **是矫枉过正，成立**
**判定：成立（轻度），定级 P1（非阻断）。**
证据：`.statuscard.error` 内 `.sc-t`(主, L254) 与 `.sc-s`(副, L261) 现在**同为 `#0a0a0a`**——色相通道被压平，主/副仅靠 15/600 vs 13/400 的尺寸与字重区分。这确实是"用一个可用性问题（对比度）换掉另一个可用性问题（层级感）"，但它 **不阻断**：对比度达标、尺寸/字重仍分级，故列 P1 而非 P0。
**建议中间值（`#FDECEB` 上实算，自行复算确认）：**
- `#686868` → **4.88:1** ✅（推荐，留足余量）
- `#6a6a6a` → 4.73 ｜ `#6b6b6b` → 4.66（可用）
- `#6d6d6d` → 4.53（贴线，勿用）｜ `#6f6f6f` → 4.40（不达标）
**改法**：
```css
:root          { --text-on-tint-secondary:#686868; }   /* 4.88:1 on #FDECEB */
[data-theme=dark]{ --text-on-tint-secondary:#a1a1a6; } /* 6.85:1 on dark-tint #2b1112 */
.statuscard.error .sc-s{ color:var(--text-on-tint-secondary); }  /* L261 替换 on-tint */
```
（深色 danger-tint 实际合成色 = `rgba(255,69,58,.14)` over `#09090b` = **#2b1112**；`#f5f5f7` 在其上 16.18:1，同样压平主副，故一并改用 `#a1a1a6`。）

### B-2 ｜ `.seg` 的 ARIA —— **是半吊子 ARIA，成立**
**判定：成立，定级 P1。**
证据：`role="tablist"`(3) + `role="tab"`(6) + `aria-selected` 有，但 **`role="tabpanel"`=0、`aria-controls`=0**；JS(L1246-1250) 仅翻转 `aria-selected`，**不切换任何面板**；两个 tab 均在 Tab 序内（无 roving tabindex）；无 Arrow 键导航。这违反 WAI-ARIA Tabs 模式：读屏会播报"tab 1 of 2, selected"却找不到对应面板，且不符合 tab 的方向键预期——是**有 role 无 panel、有 selected 无 controls**的半吊子实现。
**建议方案（二选一，推荐 A）：**
- **A（推荐）改用 `radiogroup`**：`.seg` → `role="radiogroup"`；每个按钮 → `role="radio"` + **`aria-checked`**（替换 `aria-selected`）；补 roving tabindex + ←/→ 键。
  理由：「登录 / 注册」是**二选一的模式选择（setting）**，不是平级内容面板间的导航；radiogroup 语义正确且**不需要 tabpanel**。
- B（若坚持 tabs）：必须补齐 `role="tabpanel"` 容器（带 `id`）+ 每 tab 的 `aria-controls`/`id`，JS 真正显隐面板，并实现 roving tabindex + Arrow/Home/End。当前登录/注册"面板"其实不切换，B 属勉强套用。

---

## C. 新发现的问题 / 回归（主动扫出）

| 编号 | 项 | 判定 | 说明 / 改法 |
|------|----|------|------|
| C-1 | `--radius-2xl:14px` 与 `--radius-xl:16px` **命名倒挂** | ⚠️ 新问题 P2 | 阶梯 xs6/sm8/md10/lg12/**xl16**/**2xl14** 非单调——"2xl"数值反而小于"xl"，语义误导。窗框 14 应落在 lg(12) 与 xl(16) 之间。**改法**：重命名为 `--radius-frame:14px`（语义名），或交换数值使 xl=14(帧)/2xl=16(模态)。 |
| C-2 | `<button>` 转换后是否样式污染 | ✅ 无回归 | 全局重置 L91（`background:none;border:0;cursor:pointer;font:inherit`）已覆盖；`.link-btn` 显式设 padding/line-height。14 个按钮无边框/无默认背景污染。 |
| C-3 | `inset:-9px` 是否与相邻元素重叠误点 | ✅ 无 | switch 26+18=44 **恰等于**所在 `.inset-row` 44px 高 → 不越行；pill 纵向 +9px < 上方 `.lbl` 10px 间距；seg `-6px 0` 仅纵向 6px < 14px 间距；页脚 link-btn 横向 +6px 仅触及 1px `.fw-sep`、两侧不互叠。未发现误点风险。 |
| C-4 | 8 个 `role=button` 行是否含嵌套交互元素 | ✅ 无 | 8 处（L578/579/651/652/677/678/771/1032）均只含文本+SVG；含 input/button 的"行内改名"行(L762-766) **未**被加 role=button，未违反"button 不得含交互后代"。 |
| C-5 | `.seg` 选中底 `#fff`(L191) 与 switch 滑块 `#fff`(L194) 硬编码 | ⚠️ 遗留 P2 | 轻微令牌偏离（可写 `var(--bg)`）；深色已有覆盖规则，不破例。 |
| C-6 | `.opt-nav button` 高 38px(<44) | ⚠️ 遗留 P2 | 设置页为桌面场景，优先级低；如兼顾触控可改 44px。 |

---

## D. 门控结论

**✅ 通过。**
- 5 维全部 ≥3 ✅ ｜ **P0 阻断项 = 0** ✅（全部文字 ≥4.5:1、无功能缺失、无外链、无 `window.confirm`）｜ P1 = 2（≤3）✅

**最终 5 维评分：**

| 维度 | 评分 | 说明 |
|------|------|------|
| 设计哲学 | **4/5** | neutral 徽章的哲学破例已闭合；扣分仅因 B-1 把"数字达标"置于"层级语言"之上 |
| 视觉层次 | **4/5** | 错误卡主/副同色（B-1）轻微压平层级，其余层次清晰 |
| 执行精度 | **4/5** | P0 修复、裸圆角归零、图标 95/95 统一、禁用走令牌、焦点环修正；余 C-1/C-5/C-6 三处 P2 |
| 特异性 | **4/5** | Firefox 虚拟根/墓碑/44 字符 key/op-log GC 等产品语义保留 |
| 克制 | **4/5** | 无渐变、玻璃克制、阴影仅浮层 |
| **总分** | **20/25** | 较上轮 19 → 20（执行精度 3→4） |

**非阻断建议（可选修订，不影响交付）**：
1. B-1：`.sc-s` 改 `--text-on-tint-secondary`（浅 `#686868` / 深 `#a1a1a6`），恢复主副层级而仍 >4.5:1。
2. B-2：`.seg` 改 `radiogroup`+`radio`+`aria-checked`（或补全 tabpanel/aria-controls）。
3. C-1：`--radius-2xl` 改名 `--radius-frame` 或使阶梯单调。

> 备注：上轮报告的 3 条不实自检（对比度全过 / 触控全 44 / 图标全 1.75）本轮**全部已真实修复**，且数值主张与实测逐位吻合——构建师本轮的自检可信度高。
