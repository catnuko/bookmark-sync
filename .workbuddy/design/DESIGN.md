# Bookmark Sync · 设计令牌规范（DESIGN.md）

> 设计系统：**Apple HIG（macOS/iOS 设计语言）** 为骨架，融合品牌既有黑白基因。
> 交付对象：原型构建师（prototype-builder）。所有令牌可直接落到单文件 HTML 的 `:root {}`。
> 视觉学派定位：**Modern Minimal**（现代极简）+ Apple HIG 的系统质感层。

---

# 第一部分 · 设计系统匹配

从 71 套设计系统中筛选，硬约束 = 用户原话「参考 Apple 各操作系统（macOS、iOS）的设计语言，注重留白、清晰视觉层级、一致交互体验」。因此候选必须能承载「inset grouped 卡片 + 连续圆角 + 半透明材质 + 克制阴影 + 语义色」这一套 Apple 语法，同时保留品牌既有黑白极简基因。

| 方案 | 设计系统 | 匹配度 | 特征 | 适合原因 | 风险 |
|------|---------|--------|------|---------|------|
| A | **Apple（HIG / macOS·iOS）** | ★★★★★ | inset grouped 列表、连续圆角、材质模糊、语义色板、克制动效 | 用户显式点名；本产品的「状态卡 + 设置行 + 模态」结构与 iOS 设置页同构 | 官方语义色（如 `#34C759`）在纯白上做文字只有 2.2:1，**必须派生可访问深色变体** |
| B | **Linear** | ★★★★☆ | 深灰紫、紧凑、锐利、强信息密度 | 同为工具型产品，组件语义清晰，令牌工程化程度高 | 冷紫调与「Apple 中性暖白」冲突；密度偏紧，与「大留白」诉求相悖，需大幅放松间距 |
| C | **Notion** | ★★★☆☆ | 极简黑白、大留白、系统字体、克制 | 黑白基因与本品现有品牌高度一致，留白语言相通 | 偏「文档/内容」气质，缺少状态反馈与材质层，动效几乎为零，不足以覆盖 8 个 stateful 视图 |

## 推荐：**Apple HIG（方案 A）** —— 取其神，接其形

一句话理由：**用户把 Apple HIG 定为硬约束，而本品的「弹出仪表盘 + 设置页 + 模态」信息架构与 iOS 设置页天然同构，直接用 Apple 语法的迁移成本最低、保真度最高。**

**「取其神改其形」的 3 个改造点（务必遵守）：**

1. **主操作按钮 = 黑色，不是 Apple 蓝。** 品牌 DNA 是「黑色圆角方块 Logo + 纯黑白基线」。Apple 默认交互色是蓝，但此处保留黑色主按钮（`--brand:#0a0a0a`），蓝色仅降级为 info 语义色与可选 accent。这是本方案与「标准 Apple 换皮」最大的区别。
2. **语义色必须派生可访问深色变体。** Apple 系统色（`#34C759`/`#FF3B30`/`#FF9500`/`#007AFF`）是给「屏幕发光点/指示器」用的，直接当白色背景上的文字全部 <3:1。本次为每组语义色额外派生 `-text`（≥4.5:1）与 `-tint`（浅底）+ `-border`，这是本次**最大视觉增量**。
3. **原品牌 `#a3a3a3` 被降级。** 它在 11.5px 下对比度仅 2.3:1，**禁止再用作任何文字色**，改用途为「图标 / 禁用态 / 更强分割线」。新增 `#767676`（4.54:1）作为新的文字三级灰以补位。

---

# 第二部分 · 完整设计令牌文档

> 全部以 CSS 自定义属性给出。默认交付**浅色**，`[data-theme="dark"]` 预留深色映射。
> 每个语义色后标注对比度校验结果（WCAG AA：正文 ≥4.5:1）。

## 2.1 色彩

### 品牌色
```css
/* ── 品牌色：保留黑白基因，主操作走黑色 ── */
--brand:            #0a0a0a;   /* 品牌主色 = 主按钮底色；承自现有 --fg，黑白身份锚点 */
--brand-hover:      #262626;   /* 主按钮 hover：抬亮一档，保持"无彩色"基调 */
--brand-active:     #000000;   /* 主按钮 active：压到纯黑 */
--brand-foreground: #ffffff;   /* 主按钮文字；对 --brand 对比度 19.8:1 ✓ */
--accent:           #007AFF;   /* Apple 系统蓝，仅用于"可选"强调/开关/焦点（不用于主按钮） */
```

### 中性色阶（背景层级）
```css
/* ── 背景层级：Apple 式"白页 + 内嵌浅灰卡" ── */
--bg:            #ffffff;   /* 页面底色（popup / options 主背景） */
--bg-elevated:   #f6f6f4;   /* 内嵌分组卡底色（承自现有浅底）；在白页上形成 1 级层叠 */
--bg-inset:      #ececea;   /* 控件轨道 / 按下态 / 进度条槽，比 elevated 再深一档 */
--bg-overlay:    rgba(10,10,10,0.40);  /* 模态遮罩；Apple 用 ~40% 黑 */
--bg-scrim:      rgba(10,10,10,0.06);  /* 行 hover 的浅色叠加（比直接改灰更稳） */
```

### 文字层级（全部经对比度校验）
```css
/* ── 文字层级：任何用于"内容"的色都必须 ≥4.5:1 ── */
--text-primary:     #0a0a0a;               /* 标题/正文。白底 19.8:1 ✓✓ */
--text-secondary:   #6f6f6f;               /* 次要正文/说明。白底 5.02:1 ✓（承自现有二级灰） */
--text-tertiary:    #767676;               /* 三级文字/12px 辅助。白底 4.54:1 ✓（新增，补位） */
--text-quaternary:  #a3a3a3;               /* ⚠️ 仅限非文字：图标/禁用/更强分割线。白底 2.3:1，禁止当文字 */
--text-disabled:    rgba(10,10,10,0.30);   /* 禁用态文字（豁免对比度，非内容） */
--text-placeholder: #8a8a8a;               /* 输入占位符（3.4:1，属非必读文字；如需合规可换 --text-tertiary） */
--text-on-tint:     #0a0a0a;               /* 浅色语义底卡上的文字，统一用主文字色悬于 tint 之上 */
--text-on-inset:    #5f5f5f;               /* ⚠️落在 --bg-inset(#ececea) 上的前景专用：徽章/分段未选中/键帽/地址栏。对 #ececea 5.40:1 ✓ */
                                           /*   切勿用 --text-secondary(#6f6f6f) 于 #ececea：仅 4.25:1 ✗；--text-tertiary 更低 3.84:1 ✗ */
```

### 分割线 / 边框 / 焦点
```css
/* ── 分隔与描边 ── */
--border:         #e8e8e6;   /* 默认 hairline / 卡片描边（承自现有分割线） */
--border-strong:  #d8d8d6;   /* 输入框描边 / 需要更明确边界处 */
--border-subtle:  rgba(10,10,10,0.06);  /* 内嵌行之间的极细分隔（比 #e8e8e6 更轻） */

/* ── 焦点态：a11y 硬要求，必须明显 ── */
--focus-ring:         0 0 0 2px #ffffff, 0 0 0 4px rgba(10,10,10,0.55); /* 双层环：白隙+深环，任意底色上都可见 */
--focus-ring-on-dark: 0 0 0 2px #09090b, 0 0 0 4px rgba(255,255,255,0.65);
--focus-ring-simple:  0 0 0 3px rgba(10,10,10,0.30);  /* 轻量替代：仅深色晕圈 */
--focus-offset:       1px;
```

### 语义色（含浅底 tint + 描边）—— 本次最大增量
> 结构：`-fill`（显示屏发光点/实心填充，非文字）/ `-text`（≥4.5:1，用于文字与独立图标）/ `-tint`（浅底）/ `-border`（tint 上的描边）。
```css
/* ── 成功 Success（Apple systemGreen 色相） ── */
--success-fill:   #34C759;   /* 状态点/开关 on/实心填充 */
--success-text:   #1E7A34;   /* 成功文字/图标。白底 5.40:1 ✓；色相偏深绿保证在白与浅底上都达标 */
--success-tint:   #EAF7EE;   /* 成功横幅/状态卡浅底 */
--success-border: #C7E9CF;   /* tint 卡片描边 */

/* ── 危险 Danger（Apple systemRed 色相） ── */
--danger-fill:    #FF3B30;   /* 错误状态点/实心填充 */
--danger-text:    #D70015;   /* 错误/破坏性文字。白底 5.38:1 ✓；Apple 可访问红 */
--danger-tint:    #FDECEB;   /* 错误横幅/状态卡浅底 */
--danger-border:  #F7CFCB;   /* tint 卡片描边 */

/* ── 警告 Warning（Apple systemOrange 色相，文字改用琥珀金） ── */
--warning-fill:   #FF9500;   /* 接近上限的状态点/进度条填充 */
--warning-text:   #9A6700;   /* 警告文字。白底 4.87:1 ✓；橙在白色上当文字不足，改用琥珀金 */
--warning-tint:   #FFF6E5;   /* 警告浅底 */
--warning-border: #F6DFA6;   /* tint 卡片描边 */

/* ── 信息 Info（Apple systemBlue 色相） ── */
--info-fill:      #007AFF;   /* 信息状态点/进行中填充 */
--info-text:      #0066CC;   /* 信息文字/链接。白底 5.56:1 ✓ */
--info-tint:      #EAF3FF;   /* 信息浅底 */
--info-border:    #C5DEFB;   /* tint 卡片描边 */

/* ── Armed 二次确认识别色：比 destructive 更暖、更"重" ── */
--danger-armed:       #D92D20;  /* 暖红实心，armed 填充态；配白字 4.83:1 ✓ */
--danger-armed-hover: #B91C1C;  /* armed hover 再压深 */
```

**对比度校验汇总（白底 #ffffff）**

| Token | HEX | 对比度 | 结论 |
|-------|-----|-------|------|
| `--text-primary` | #0a0a0a | 19.8:1 | ✓✓ 远超 AA |
| `--text-secondary` | #6f6f6f | 5.02:1 | ✓ AA |
| `--text-tertiary` | #767676 | 4.54:1 | ✓ AA（贴线，勿再调浅） |
| `--text-quaternary` | #a3a3a3 | 2.30:1 | ✗ 禁用作文字 |
| `--success-text` | #1E7A34 | 5.40:1 | ✓ AA |
| `--danger-text` | #D70015 | 5.38:1 | ✓ AA |
| `--warning-text` | #9A6700 | 4.87:1 | ✓ AA |
| `--info-text` | #0066CC | 5.56:1 | ✓ AA |
| `--brand-foreground` on `--brand` | #fff / #0a0a0a | 19.8:1 | ✓✓ |

---

## 2.2 字体

```css
/* ── 字体栈：Apple 系统字体优先，逐级回退到中英文系统字体 ── */
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
             "Helvetica Neue", "PingFang SC", "Hiragino Sans GB",
             "Microsoft YaHei", system-ui, sans-serif;
--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco,
             "Cascadia Code", "Roboto Mono", "Courier New", monospace;

/* ── 字号阶梯（弹窗场景专用，主 15–17 / 次 13 / 辅助 12） ── */
--fs-title-lg:  17px;   /* 页面标题 / 模态标题（iOS .headline 同级） */
--fs-title:     15px;   /* 卡片标题 / 区块标题 */
--fs-body:      15px;   /* 主正文（弹窗舒适阅读下限） */
--fs-secondary: 13px;   /* 次要说明（≥12px 且用 --text-secondary ≥4.5:1） */
--fs-caption:   12px;   /* 辅助信息 / 页脚链接（全站文字下限） */
--fs-badge:     11px;   /* 仅限全大写徽章/键帽等"非阅读性"标签，配 ≥4.5:1 的色 */

/* ── 行高（按尺寸配套，标题紧、正文松） ── */
--lh-title-lg:  22px;   /* 17 ≈ 1.29 */
--lh-title:     20px;   /* 15 ≈ 1.33 */
--lh-body:      21px;   /* 15 ≈ 1.40 */
--lh-secondary: 18px;   /* 13 ≈ 1.38 */
--lh-caption:   16px;   /* 12 ≈ 1.33 */

/* ── 字重 ── */
--fw-regular:  400;   /* 正文默认 */
--fw-medium:   500;   /* 强调 / 列表标签 / 分段控件 */
--fw-semibold: 600;   /* 标题 / 按钮 / 数值 */
--fw-bold:     700;   /* 仅超大标题，弹窗内基本不用 */

/* ── 字距：大字收紧、小字归零（Apple 光学字距习惯） ── */
--ls-title-lg:  -0.02em;
--ls-title:     -0.01em;
--ls-body:      0em;
--ls-caption:   0em;
```

---

## 2.3 间距（4pt 基准）

```css
/* ── 间距刻度：4 的倍数，弹窗内以 4/8/12/16/20 为主 ── */
--space-0:  0;
--space-1:  4px;    /* 图标与文字的内间距、徽章内边距 */
--space-2:  8px;    /* 紧凑行距、按钮图标与文字 */
--space-3:  12px;   /* 卡片内"行"之间的间隔 */
--space-4:  16px;   /* ★弹窗内边距 / 卡片内边距基准 */
--space-5:  20px;   /* 区块间较大间隔 */
--space-6:  24px;   /* 分组之间 / 模态内边距 */
--space-8:  32px;   /* 大区块分隔 */

/* ── 弹窗(<600px 高)密度约束：≤3 信息块 ── */
--popup-width:        400px;
--popup-padding-x:    16px;   /* 左右内边距 */
--popup-padding-y:    14px;   /* 上下内边距 */
--popup-block-gap:    12px;   /* ①②③ 卡之间间隔（--space-3） */
--card-padding-x:     14px;
--card-padding-y:     12px;
--card-row-gap:       10px;   /* 卡片内部行间隔 */
--footer-gap:         8px;    /* 页脚帮助/设置链接间隔 */
```
> **密度上限说明**：400×(≈600) 的弹窗，垂直预算 ≈600−28(上下 padding) ≈572px。以「状态卡(~64) + 配额卡(~72) + 主按钮(44) + 2 行快捷行(~88) + 页脚(28) + 4×12 间隔」计 ≈ 344px，仍留 ~230px 呼吸余量，符合「大留白」。**首屏信息块硬上限 = 3 个卡片**，超出一律收进二级面板/抽屉。

---

## 2.4 圆角（统一阶梯）

```css
/* ── 圆角阶梯：从现有 12/9/10/16/8/7 收敛为 7 级，每级职责唯一 ── */
--radius-xs:   6px;    /* 徽章、键帽、极小图标容器 */
--radius-sm:   8px;    /* 内嵌行/列表行、分段控件选中项、小控件 */
--radius-md:   10px;   /* ★按钮、输入框（对齐 Apple 控件 10px） */
--radius-lg:   12px;   /* ★分组卡片容器（承袭品牌既有 12px） */
--radius-frame:14px;   /* 浏览器窗框 / 演示型外壳专用（产品内控件不用；值 14 小于 xl 的 16，命名避免与 xl 倒挂） */
--radius-xl:   16px;   /* 模态、抽屉/二级面板 */
--radius-full: 999px;  /* 胶囊：状态徽章、进度条、开关、头像、分段控件轨道 */

/* 连续圆角（progressive enhancement，可选） */
--corner-squircle: superellipse(1.6);  /* 支持 corner-shape 的浏览器可启用 Apple 式连续圆角；不支持则自动忽略 */
```

---

## 2.5 阴影 / 材质

```css
/* ── Elevation：Apple 式克制，仅浮层/模态/悬浮使用；卡片默认扁平靠"底色分层" ── */
--shadow-none:    none;                                    /* L0 卡片/内嵌行默认：扁平 */
--shadow-raised:  0 1px 2px rgba(10,10,10,0.05),
                  0 1px 3px rgba(10,10,10,0.06);           /* L1 可交互卡片 hover / 分段滑块 */
--shadow-popover: 0 4px 16px rgba(10,10,10,0.10),
                  0 1px 3px rgba(10,10,10,0.06);           /* L2 下拉/气泡/二级面板 */
--shadow-modal:   0 12px 40px rgba(10,10,10,0.18),
                  0 2px 8px rgba(10,10,10,0.08);           /* L3 模态 */
--shadow-toast:   0 8px 24px rgba(10,10,10,0.16);          /* L4 Toast / 状态条 */

/* ── Z-index 阶梯 ── */
--z-base:     0;
--z-sticky:   100;
--z-popover:  200;
--z-modal:    300;
--z-toast:    400;

/* ── 材质（Apple 半透明模糊；用于模态、粘性页脚、二级面板） ── */
--material-thick:   rgba(255,255,255,0.92);  /* 大面板/模态：高遮盖 */
--material-regular: rgba(255,255,255,0.75);  /* 粘性页脚/工具条 */
--material-thin:    rgba(255,255,255,0.55);  /* 轻量浮层 */
--material-blur:    blur(20px) saturate(180%);  /* 统一模糊核 */
--material-blur-sm: blur(8px) saturate(160%);   /* 遮罩/小浮层 */
/* 降级：不支持 backdrop-filter 时，改用对应实色（厚→#ffffff，常规→#f6f6f4，轻→#f6f6f4） */
```
> **降级策略**：`@supports not (backdrop-filter: blur(1px))` 时，把 `--material-*` 换成不透明实色（`#ffffff` / `#f6f6f4`），并去掉 `backdrop-filter`。功能与层级不丢失，只是少了"通透感"。

---

## 2.6 动效

```css
/* ── 时长：Apple 习惯"进场稍慢、出场更快" ── */
--dur-instant: 100ms;   /* hover 变色、按下反馈 */
--dur-fast:    160ms;   /* 透明度/颜色过渡、分段滑块 */
--dur-base:    240ms;   /* 手风琴展开收起、抽屉滑入 */
--dur-slow:    320ms;   /* 模态进场 */
--dur-exit:    200ms;   /* 模态/浮层退场（出场快于进场） */
--dur-spin:    800ms;   /* 同步中 spinner 一圈 */

/* ── 缓动曲线 ── */
--ease-standard:    cubic-bezier(0.25, 0.10, 0.25, 1.00);  /* 通用标准 */
--ease-decelerate:  cubic-bezier(0.00, 0.00, 0.20, 1.00);  /* 进场（快起慢收，模态最常用） */
--ease-accelerate:  cubic-bezier(0.40, 0.00, 1.00, 1.00);  /* 退场 */
--ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1.00);  /* 轻微回弹：armed 确认、徽章弹入 */
--ease-ios-inout:   cubic-bezier(0.42, 0.00, 0.58, 1.00);  /* 对称过渡：抽屉/手风琴 */
--ease-linear:      linear;                                 /* spinner 匀速 */
```
> 用途对照：**armed 二次确认**用 `--dur-base + --ease-spring`（带一下弹感，强调"这次是真删"）；**手风琴/抽屉**用 `--dur-base + --ease-ios-inout`；**模态进出**用 `--dur-slow/--ease-decelerate` 进、`--dur-exit/--ease-accelerate` 出；**同步 spinner**用 `--dur-spin + --ease-linear`。

---

## 2.7 组件令牌

### 按钮
```css
/* ── 尺寸：视觉高对 44/36/32；紧凑按钮用"隐形热区"补到 ≥44 触控目标 ── */
--btn-h-lg: 44px;    /* 主操作通栏（立即同步）；天然满足触控 */
--btn-h-md: 36px;    /* 默认按钮 */
--btn-h-sm: 32px;    /* 紧凑按钮（快捷行/模态内）视觉高，配 --hit-slop 补足热区 */
--btn-pad-x: 14px;
--btn-radius: var(--radius-md);   /* 10px */
--hit-target-min: 44px;           /* 触控目标硬下限 */
--hit-slop: 6px;                  /* ::before inset:-6px 扩展热区（32+6×2=44） */

/* ── 变体：底色 / 文字 / 描边 / hover / active ── */
--btn-primary-bg:        var(--brand);            /* #0a0a0a */
--btn-primary-fg:        var(--brand-foreground); /* #ffffff */
--btn-primary-bg-hover:  var(--brand-hover);      /* #262626 */
--btn-primary-bg-active: var(--brand-active);     /* #000000 */

--btn-secondary-bg:       var(--bg-elevated);     /* #f6f6f4 */
--btn-secondary-fg:       var(--text-primary);
--btn-secondary-bg-hover: var(--bg-inset);        /* #ececea */

--btn-ghost-bg:        transparent;
--btn-ghost-fg:        var(--text-primary);
--btn-ghost-bg-hover:  var(--bg-scrim);           /* rgba(10,10,10,0.06) */

/* ── Destructive（安静态：描边红，如"删除同步数据"） ── */
--btn-destructive-bg:       transparent;
--btn-destructive-fg:       var(--danger-text);   /* #D70015 */
--btn-destructive-border:   var(--danger-border);
--btn-destructive-bg-hover: var(--danger-tint);

/* ── Armed（二次确认：由安静红翻转为"暖红实心"+ 倒计时，见第三部分） ── */
--btn-armed-bg:       var(--danger-armed);        /* #D92D20 */
--btn-armed-fg:       #ffffff;                    /* 对 armed 底色 4.83:1 ✓ */
--btn-armed-bg-hover: var(--danger-armed-hover);  /* #B91C1C */
--btn-armed-ring:     0 0 0 3px rgba(217,45,32,0.22);  /* 呼吸脉冲环 */

/* ── 禁用 ── */
--btn-disabled-bg: rgba(10,10,10,0.28);
--btn-disabled-fg: rgba(255,255,255,0.85);
```

### 输入框
```css
--input-h:            36px;
--input-h-lg:         44px;
--input-bg:           #ffffff;
--input-border:       1px solid var(--border-strong);   /* #d8d8d6 */
--input-radius:       var(--radius-md);                 /* 10px */
--input-pad:          10px 12px;
--input-fg:           var(--text-primary);
--input-placeholder:  var(--text-placeholder);
--input-border-focus: 1.5px solid var(--brand);         /* 聚焦描边转黑 + 外环 */
--input-ring-focus:   var(--focus-ring-simple);         /* 0 0 0 3px rgba(10,10,10,.30) */
--input-border-error: 1.5px solid var(--danger-text);   /* #D70015 */
--input-ring-error:   0 0 0 3px rgba(215,0,21,0.18);
```

### 卡片 / 内嵌行
```css
/* ── 分组卡：白页上的浅灰内嵌块，靠底色分层，默认无描边无阴影 ── */
--card-bg:        var(--bg-elevated);   /* #f6f6f4 */
--card-radius:    var(--radius-lg);     /* 12px */
--card-padding:   12px 14px;
--card-border:    none;
--card-shadow:    var(--shadow-none);
--card-hover-shadow: var(--shadow-raised);  /* 仅"可点击卡片"hover 时才抬起 */

/* ── inset 行：卡内列表行，用极细 hairline 分隔 ── */
--row-min-h:      44px;
--row-padding:    10px 14px;
--row-separator:  1px solid var(--border-subtle);  /* rgba(10,10,10,0.06) */
--row-bg-hover:   var(--bg-scrim);
--row-chevron:    var(--text-quaternary);  /* ▸ 指示符，非文字，可用浅灰 */
```

### 徽章 / 胶囊
```css
--badge-h:        20px;
--badge-pad:      2px 8px;
--badge-radius:   var(--radius-full);
--badge-fs:       var(--fs-badge);   /* 11px，全大写标签 */
--badge-fw:       var(--fw-semibold);

--badge-neutral-bg: var(--bg-inset);     --badge-neutral-fg: var(--text-on-inset);   /* ⚠️ 不可用 --text-secondary：对 #ececea 仅 4.25:1 */
--badge-success-bg: var(--success-tint); --badge-success-fg: var(--success-text);
--badge-danger-bg:  var(--danger-tint);  --badge-danger-fg:  var(--danger-text);
--badge-warning-bg: var(--warning-tint); --badge-warning-fg: var(--warning-text);
--badge-info-bg:    var(--info-tint);    --badge-info-fg:    var(--info-text);
```

### 分段控件
```css
--seg-track-bg:     var(--bg-inset);       /* #ececea */
--seg-track-radius: var(--radius-full);
--seg-track-pad:    2px;
--seg-thumb-bg:     #ffffff;
--seg-thumb-radius: var(--radius-sm);      /* 8px */
--seg-thumb-shadow: var(--shadow-raised);
--seg-item-fs:      var(--fs-secondary);   /* 13px */
--seg-item-fw:      var(--fw-medium);
--seg-item-fg:      var(--text-secondary);
--seg-item-fg-active: var(--text-primary);
--seg-item-h:       30px;
```

### 开关（Toggle）
```css
--switch-w:        44px;
--switch-h:        26px;
--switch-knob:     22px;
--switch-track-off: var(--bg-inset);     /* #ececea */
--switch-track-on:  var(--success-fill); /* #34C759 */
--switch-knob-bg:   #ffffff;
--switch-knob-shadow: 0 1px 3px rgba(10,10,10,0.25), 0 0 1px rgba(10,10,10,0.15);
--switch-dur:       var(--dur-fast);     /* 160ms */
--switch-ease:      var(--ease-standard);
```

### 进度条（配额）
```css
--progress-h:        6px;
--progress-radius:   var(--radius-full);
--progress-track:    rgba(10,10,10,0.08);
--progress-fill:     var(--brand);        /* 正常：品牌黑 */
--progress-fill-warn: var(--warning-fill);/* ≥90%：琥珀 #FF9500 */
--progress-fill-over: var(--danger-fill); /* 超限：红 #FF3B30 */
--progress-dur:      var(--dur-base);
--progress-ease:     var(--ease-decelerate);
```

### 模态
```css
--modal-width:      min(320px, calc(100% - 32px));
--modal-bg:         var(--material-thick);   /* 半透白 + 模糊 */
--modal-radius:     var(--radius-xl);        /* 16px */
--modal-padding:    20px;
--modal-shadow:     var(--shadow-modal);
--modal-title-fs:   var(--fs-title-lg);      /* 17px */
--modal-title-fw:   var(--fw-semibold);
--modal-body-fs:    var(--fs-secondary);     /* 13px */
--modal-body-fg:    var(--text-secondary);
--modal-gap:        16px;
--modal-btn-gap:    8px;
--modal-enter-dur:  var(--dur-slow);         /* 320ms */
--modal-exit-dur:   var(--dur-exit);         /* 200ms */
--modal-ease:       var(--ease-decelerate);
--scrim-bg:         var(--bg-overlay);       /* rgba(10,10,10,0.40) */
--scrim-blur:       var(--material-blur-sm); /* blur(8px) saturate(160%) */
```

### Toast / 状态条
```css
--toast-radius:   var(--radius-md);      /* 10px */
--toast-pad:      10px 14px;
--toast-bg:       var(--bg-elevated);    /* 中性：#f6f6f4 + 左边语义色条 */
--toast-shadow:   var(--shadow-toast);
--toast-fs:       var(--fs-secondary);   /* 13px */
--toast-fg:       var(--text-primary);
--toast-accent-w: 3px;                   /* 左侧语义色指示条宽度 */
```

---

## 2.8 深色模式映射（预留，`[data-theme="dark"]`；承自官网深色 #09090b）
```css
[data-theme="dark"] {
  /* 背景层级 */
  --bg:            #09090b;
  --bg-elevated:   #1c1c1e;
  --bg-inset:      #2c2c2e;
  --bg-scrim:      rgba(255,255,255,0.06);
  --bg-overlay:    rgba(0,0,0,0.55);

  /* 文字层级（在 #09090b 上均 ≥4.5:1） */
  --text-primary:    #f5f5f7;   /* ≈ 18:1 ✓ */
  --text-secondary:  #a1a1a6;   /* 7.7:1 ✓ */
  --text-tertiary:   #8e8e93;   /* ≈ 5.0:1 ✓ */
  --text-quaternary: #636366;   /* 非文字 */
  --text-disabled:   rgba(255,255,255,0.30);
  --text-on-inset:   #c7c7cc;   /* 落在深色 --bg-inset(#2c2c2e) 上的前景，8.28:1 ✓ */
  --text-on-tint:    #f5f5f7;   /* 深色语义 tint 底上的文字（主级，满对比） */
  --text-on-tint-secondary: #a1a1a6; /* 语义 tint 底上的次级文字，保留层级（对深色 danger-tint 16.18:1 ✓），不可与主级同色 */
  --btn-disabled-bg: rgba(255,255,255,0.16);
  --btn-disabled-fg: rgba(255,255,255,0.55);

  /* 品牌与描边 */
  --brand:          #f5f5f7;   /* 深色下主按钮翻转为浅色 */
  --brand-hover:    #ffffff;
  --brand-foreground: #09090b;
  --border:         #2c2c2e;
  --border-strong:  #3a3a3c;
  --border-subtle:  rgba(255,255,255,0.08);
  --focus-ring:     0 0 0 2px #09090b, 0 0 0 4px rgba(255,255,255,0.65);

  /* 语义色：改用 Apple 深色系统色（在深底上达标） */
  --success-fill: #34C759;  --success-text: #30D158;  --success-tint: rgba(52,199,89,0.14);  --success-border: rgba(52,199,89,0.30);
  --danger-fill:  #FF453A;  --danger-text:  #FF453A;  --danger-tint:  rgba(255,69,58,0.14);  --danger-border:  rgba(255,69,58,0.30);
  --warning-fill: #FFD60A;  --warning-text: #FFD60A;  --warning-tint: rgba(255,214,10,0.14); --warning-border: rgba(255,214,10,0.30);
  --info-fill:    #0A84FF;  --info-text:    #0A84FF;  --info-tint:    rgba(10,132,255,0.16); --info-border:    rgba(10,132,255,0.32);
  --danger-armed: #FF453A;  --danger-armed-hover: #FF6961;

  /* 材质 / 阴影 */
  --material-thick:   rgba(28,28,30,0.92);
  --material-regular: rgba(28,28,30,0.75);
  --material-thin:    rgba(28,28,30,0.55);
  --shadow-raised:  0 1px 2px rgba(0,0,0,0.40);
  --shadow-popover: 0 4px 16px rgba(0,0,0,0.50);
  --shadow-modal:   0 12px 40px rgba(0,0,0,0.60);
}
```

---

## 2.9 可直接粘贴的 `:root` 快取块（原型构建师用）
```css
:root {
  /* 品牌 */
  --brand:#0a0a0a; --brand-hover:#262626; --brand-active:#000; --brand-foreground:#fff; --accent:#007AFF;
  /* 背景 */
  --bg:#fff; --bg-elevated:#f6f6f4; --bg-inset:#ececea; --bg-overlay:rgba(10,10,10,.40); --bg-scrim:rgba(10,10,10,.06);
  /* 文字 */
  --text-primary:#0a0a0a; --text-secondary:#6f6f6f; --text-tertiary:#767676; --text-quaternary:#a3a3a3;
  --text-disabled:rgba(10,10,10,.30); --text-placeholder:#8a8a8a; --text-on-tint:#0a0a0a; --text-on-tint-secondary:#686868; --text-on-inset:#5f5f5f;
  /* 描边/焦点 */
  --border:#e8e8e6; --border-strong:#d8d8d6; --border-subtle:rgba(10,10,10,.06);
  --focus-ring:0 0 0 2px #fff,0 0 0 4px rgba(10,10,10,.55); --focus-ring-simple:0 0 0 3px rgba(10,10,10,.30);
  /* 语义 */
  --success-fill:#34C759; --success-text:#1E7A34; --success-tint:#EAF7EE; --success-border:#C7E9CF;
  --danger-fill:#FF3B30; --danger-text:#D70015; --danger-tint:#FDECEB; --danger-border:#F7CFCB;
  --warning-fill:#FF9500; --warning-text:#9A6700; --warning-tint:#FFF6E5; --warning-border:#F6DFA6;
  --info-fill:#007AFF; --info-text:#0066CC; --info-tint:#EAF3FF; --info-border:#C5DEFB;
  --danger-armed:#D92D20; --danger-armed-hover:#B91C1C;
  /* 字体 */
  --font-sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --font-mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Monaco,"Cascadia Code","Roboto Mono",monospace;
  --fs-title-lg:17px; --fs-title:15px; --fs-body:15px; --fs-secondary:13px; --fs-caption:12px; --fs-badge:11px;
  --lh-title-lg:22px; --lh-title:20px; --lh-body:21px; --lh-secondary:18px; --lh-caption:16px;
  --fw-regular:400; --fw-medium:500; --fw-semibold:600; --fw-bold:700;
  /* 间距 */
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px; --space-6:24px; --space-8:32px;
  --popup-width:400px; --popup-padding-x:16px; --popup-padding-y:14px; --popup-block-gap:12px;
  --card-padding-x:14px; --card-padding-y:12px; --card-row-gap:10px;
  /* 圆角 */
  --radius-xs:6px; --radius-sm:8px; --radius-md:10px; --radius-lg:12px; --radius-xl:16px; --radius-frame:14px; --radius-full:999px;
  /* 阴影/材质 */
  --shadow-none:none; --shadow-raised:0 1px 2px rgba(10,10,10,.05),0 1px 3px rgba(10,10,10,.06);
  --shadow-popover:0 4px 16px rgba(10,10,10,.10),0 1px 3px rgba(10,10,10,.06);
  --shadow-modal:0 12px 40px rgba(10,10,10,.18),0 2px 8px rgba(10,10,10,.08); --shadow-toast:0 8px 24px rgba(10,10,10,.16);
  --material-thick:rgba(255,255,255,.92); --material-regular:rgba(255,255,255,.75); --material-thin:rgba(255,255,255,.55);
  --material-blur:blur(20px) saturate(180%); --material-blur-sm:blur(8px) saturate(160%);
  --z-base:0; --z-sticky:100; --z-popover:200; --z-modal:300; --z-toast:400;
  /* 动效 */
  --dur-instant:100ms; --dur-fast:160ms; --dur-base:240ms; --dur-slow:320ms; --dur-exit:200ms; --dur-spin:800ms;
  --ease-standard:cubic-bezier(.25,.10,.25,1); --ease-decelerate:cubic-bezier(0,0,.20,1); --ease-accelerate:cubic-bezier(.40,0,1,1);
  --ease-spring:cubic-bezier(.34,1.56,.64,1); --ease-ios-inout:cubic-bezier(.42,0,.58,1); --ease-linear:linear;
  /* 组件：按钮 */
  --btn-h-lg:44px; --btn-h-md:36px; --btn-h-sm:32px; --btn-pad-x:14px; --btn-radius:var(--radius-md); --hit-target-min:44px; --hit-slop:6px;
  --btn-secondary-bg:var(--bg-elevated); --btn-ghost-bg-hover:var(--bg-scrim);
  --btn-destructive-fg:var(--danger-text); --btn-destructive-border:var(--danger-border);
  --btn-armed-bg:var(--danger-armed); --btn-armed-fg:#fff; --btn-armed-ring:0 0 0 3px rgba(217,45,32,.22);
  --btn-disabled-bg:rgba(10,10,10,.28); --btn-disabled-fg:rgba(255,255,255,.85);
  /* 组件：输入/卡片/徽章/分段/开关/进度/模态/Toast */
  --input-h:36px; --input-bg:#fff; --input-radius:var(--radius-md);
  --card-bg:var(--bg-elevated); --card-radius:var(--radius-lg);
  --badge-radius:var(--radius-full); --seg-track-radius:var(--radius-full); --seg-thumb-radius:var(--radius-sm);
  --switch-w:44px; --switch-h:26px; --switch-knob:22px; --switch-track-on:var(--success-fill);
  --progress-h:6px; --progress-track:rgba(10,10,10,.08);
  --modal-width:min(320px,calc(100% - 32px)); --modal-radius:var(--radius-xl); --modal-padding:20px; --modal-shadow:var(--shadow-modal);
}
```

---

# 第三部分 · 关键组件视觉规范

## 3.1 同步状态卡（4 态）

**通用结构**（Apple 式「前导图标 + 两行文本 + 尾部动作」）：
```
┌─ card (12px 14px, r12, bg=--bg-elevated) ───────────┐
│  ●  [glyph]   主文案 (15/600, --text-primary)     尾部 │
│               副文案 (13/400, --text-secondary)   动作 │
└─────────────────────────────────────────────────────┘
```
- 前导：`20×20` 状态点或图标，前导与文本间距 `--space-2(8px)`；图标与主文案基线对齐。
- 尾部：相对时间 `13px --text-tertiary`，或一个 `--btn-ghost` 重试按钮。

| 状态 | 图标（SF Symbol 语义） | 语义色 | 主文案 | 副文案 | 卡片底色 |
|------|----------------------|--------|--------|--------|---------|
| ① 已同步正常 | `checkmark.circle.fill` 对勾圆 | `--success`（点 `--success-fill`，独立图标用 `--success-text`） | **已同步** | `2 分钟前 · 128 条书签`（`--text-secondary`） | 默认 `--bg-elevated`；可选极浅 `--success-tint` |
| ② 同步中 | `arrow.triangle.2.circlepath` 旋转 | `--info`（`--info-fill`） | **正在同步…** | `正在上传 3 项变更` | 默认；spinner 用 `--dur-spin` 匀速旋转 |
| ③ 从未同步 | `icloud.slash` 云划线 | 中性 `--text-tertiary` | **尚未同步** | `点击下方按钮开始首次同步` | 默认 |
| ④ 出错 | `exclamationmark.triangle.fill` 感叹三角 | `--danger`（图标用 `--danger-text`，状态点用 `--danger-fill`） | **同步失败** | `网络超时，点击重试` + 尾部「重试」ghost 按钮 | `--danger-tint` + 描边 `--danger-border` |

**文案层级规则**：主文案 15/600 主色，副文案 13/400 次色；错误态主文案保持主色（不染红），**只有图标与尾部动作染红**——避免"整卡通红"的廉价感，同时靠左描边/浅底传达语义。

---

## 3.2 Armed 二次确认按钮（不可逆操作的明确表达）

**两阶段模型** —— 与普通 destructive 用「填充反转 + 暖色相 + 动效 + 文案」四重手段区分：

**阶段 1 · 安静态（=普通 destructive）**
```
[ 删除同步数据 ]   ── 透明底 / 文本 --danger-text / 描边 --danger-border
```
用户第一击 → 进入 armed。**关键：普通 destructive 是"安静的红字"**，本身不做事，只是入口。

**阶段 2 · Armed（3 秒内再点即执行不可逆）**
```
╭───────────────────────────────╮
│   ● 再次点击以确认删除 (3)     │   ── 实心暖红 --danger-armed，白字 4.83:1
╰───────────────────────────────╯
      ← 外圈 3px 呼吸脉冲环 --btn-armed-ring
```
- **色相**：`#D92D20`（暖红）——比 destructive `#D70015`（冷纯红）更暖、更"重"，让人感到"这是实心按钮、已经被按下"。
- **形态**：由「透明描边」翻转为「实心填充」，视觉重量骤增，触发警觉。
- **倒计时**：文案内嵌 `(3)→(2)→(1)`，每 `1000ms` 递减；环形/描边用 `--ease-linear` 从满到空收缩，直观表示剩余时间。
- **动效**：进入 armed 用 `--dur-base(240ms) + --ease-spring`，带一次轻微回弹，强化"按钮刚刚变形"的反馈。
- **自动回退**：3 秒无操作 → `--dur-exit(200ms) + --ease-accelerate` 淡回阶段 1 的安静态，防止误触遗留。
- **区别于 destructive 的三条**：(1) 实心 vs 描边；(2) 暖红 vs 冷红；(3) 有倒计时与脉冲 vs 静态。

---

## 3.3 配额进度条（三态）

**结构**：
```
Free · 128/500 条                    ← 左侧 13/500 次色；右侧数值 13/600 主色
[████████░░░░░░░░░░░░]               ← 轨道 6px，r=999，槽 rgba(10,10,10,.08)
```

| 态 | 触发 | 填充色 | 文本色 | 文案 | 附加 |
|----|------|--------|--------|------|------|
| 正常 | <90% | `--progress-fill`（品牌黑 `#0a0a0a`） | 数值 `--text-primary` | `Free · 128/500 条` | 无 |
| 告警 | ≥90% | `--progress-fill-warn`（`#FF9500`） | 徽章 `--warning-text` `#9A6700` | `接近上限 · 460/500 条` | 右侧「升级」ghost 按钮浮现 |
| 超限 | >100% | `--progress-fill-over`（`#FF3B30`） | 徽章 `--danger-text` `#D70015` | `已超出配额 · 512/500 条` | 进度条填充封顶 100%，尾端加 `--danger-fill` 圆点；「升级」变 `--btn-primary` |

- 填充宽度过渡 `--dur-base(240ms) + --ease-decelerate`；告警/超限切换时填充色用同样时长平滑过渡，避免"跳变"。
- 三态色均取自语义色族，与状态卡、徽章共享同一套 token，保证全站一致。

---

## 3.4 模态（Apple 风格）

**结构（居中 alert 型，用于「新设备密钥引导 / 首同步决策 / 升级」）**：
```
        ┌─────── modal (min(320,100%-32), r16, p20) ────────┐
        │                                                   │
        │              标题 17/600 主色（居中）              │
        │        正文 13/400 次色，行高 18，居中            │
        │                                                   │
        │   ┌─────────────┐  ┌─────────────┐               │
        │   │  次要按钮    │  │  主要按钮    │  ← 双按钮横排  │
        │   └─────────────┘  └─────────────┘               │
        └───────────────────────────────────────────────────┘
                    遮罩 rgba(10,10,10,.40) + blur(8px)
```

- **圆角**：`--modal-radius = 16px`（`--radius-xl`）；比卡片(12)更大，体现"层级更高"。
- **内边距**：`20px` 四周；标题→正文 `--modal-gap(16px)`，正文→按钮 `16px`。
- **排布**：标题、正文居中（iOS alert 习惯）；按钮横排，`--modal-btn-gap(8px)`，两键等宽 `flex:1`。
- **主/次按钮顺序**：视觉上**主操作在右**（Apple macOS 约定）；移动端可改为纵向堆叠、主操作在上。
- **材质**：`--material-thick`（rgba(255,255,255,.92)）+ `backdrop-filter: var(--material-blur)`；不支持时降级为实色 `#ffffff`。
- **遮罩**：`rgba(10,10,10,0.40)` + `blur(8px)`；遮罩本身 `--dur-slow` 淡入。
- **进出**：进场 `--dur-slow(320ms)+--ease-decelerate`（模态从 0.96 缩放到 1 + 淡入）；出场 `--dur-exit(200ms)+--ease-accelerate`。
- **阴影**：`--shadow-modal`（`0 12px 40px rgba(10,10,10,.18)`），全站唯一使用重阴影的位置，与"仅浮层有阴影"的品牌基因一致。

---

## 3.5 页脚与快捷行（补充，供分块参考）

- **快捷行**（空间与设备 ▸ / 同步密钥 ▸）：min-height `44px`、`--row-padding`、右侧 `▸` 用 `--text-quaternary`，`hover` 用 `--row-bg-hover`。
- **页脚**：`帮助 · 设置` 两枚 12px/400 `--text-tertiary` 文字链接，间隔 `--footer-gap(8px)`，整行居中，上方 `--border-subtle` hairline。

---

# 附录 · 硬性要求自查（对齐 Phase 1 诊断 10 条）

| # | 要求 | 落地令牌/规范 | 状态 |
|---|------|--------------|------|
| 1 | 必须有语义色（4 组 + tint） | success/danger/warning/info 各含 `-fill/-text/-tint/-border` | ✓ |
| 2 | 对比度 ≥4.5:1 | 文字层级与 `-text` 全部校验并列表（`#a3a3a3` 降级为图标色） | ✓ |
| 3 | 触控目标 ≥44px | `--hit-target-min:44px`、`--btn-h-sm:32px` + `--hit-slop:6px` 隐形热区 | ✓ |
| 4 | 圆角统一阶梯 | `--radius-xs/sm/md/lg/xl/full` 6 级，每级注明用途 | ✓ |
| 5 | 字号阶梯 + 行高 | 17/15/13/12/11 + 配套 lh + 字重 | ✓ |
| 6 | 4/8pt 间距 + 密度上限 | `--space-*` + 弹窗首屏 ≤3 卡约束 | ✓ |
| 7 | 阴影/材质 + 降级 | 4 级 elevation + `--material-*` + `@supports` 降级 | ✓ |
| 8 | 动效令牌 | 6 时长 + 6 缓动，含 armed/手风琴/模态/spinner 用途 | ✓ |
| 9 | 深浅色 | 浅色为主交付 + `[data-theme="dark"]` 全量映射 | ✓ |
| 10 | 焦点态 | `--focus-ring` 双层环 + `--focus-ring-simple` | ✓ |

---
## 修订记录
- **v1.1（原型 P0/P1 复审回写）**
  - 新增 `--text-on-inset`：浅 `#5f5f5f`（对 `#ececea` 5.40:1 ✓）/ 深 `#c7c7cc`（对 `#2c2c2e` 8.28:1 ✓）。修正 `.badge-neutral`、分段控件未选中态、`kbd`、地址栏在 `--bg-inset` 上的对比度破例（原 `--text-secondary` 仅 4.25:1）。
  - `--badge-neutral-fg` 由 `var(--text-secondary)` 改为 `var(--text-on-inset)`（缺陷源头修正）。
  - 新增 `--radius-frame: 14px`：用于浏览器窗框/演示外壳外层容器（演示外壳专用），产品内控件仍用 xs–xl。命名刻意避开 `--radius-2xl` 以免与 `--radius-xl:16px` 非单调倒挂。
  - 显式登记深色 `--text-on-tint:#f5f5f7`、`--btn-disabled-bg/-fg`（浅 `rgba(10,10,10,.28)` / 深 `rgba(255,255,255,.16)`）。
  - 补充约束：语义 tint 卡片（如 `.statuscard.error` 的 `--danger-tint`）上的**主文案**用 `--text-on-tint`，**次级文案**用 `--text-on-tint-secondary`（浅 `#686868` 4.88:1 / 深 `#a1a1a6` 16.18:1），避免次级文字与主文案同色压平层级、也避免 `--text-secondary` 在 tint 上跌破 4.5:1。

---
*Bookmark Sync 设计令牌 v1.0（+v1.1 回写）· 设计系统专家 彩格调（Cai）产出 · 骨架 Apple HIG，基因黑白极简*
