# Bookmark Sync 插件 · shadcn 风格重写设计规范

> 方案 A（catnuko 已拍板）：插件 UI 迁移到 **shadcn-vue + Tailwind CSS**，全量重写样式层。
> 本文档是唯一的视觉与组件规范来源，开发照此实现，不再参考 tokens.css 的旧样式。
> 业务逻辑（`store.js`、`lib/*`、i18n、CRDT/同步）**一律不动**，只动视图层与样式层。

---

## 1. 背景与约束

- 现状：Vue 3（`<script setup>`）+ 自研 `src/styles/tokens.css`（1544 行），约 24 个 SFC，无组件库。视觉是 iOS/macOS 系统风（SF 字体、#007aff 强调色、拟态弹窗、macOS 窗口点装饰）。
- 目标：官方 shadcn/ui 的视觉与组件体系，但框架不换 React——用社区移植版 **shadcn-vue**。
- 两个宿主：popup（固定 400×600）与 options 设置页（左侧导航 + 内容区），共用同一套组件。
- 现有暗色主题 token 已完整存在（`[data-theme='dark']`），产品暂未暴露切换入口，**保留双主题定义，不新做切换 UI**。

## 2. 技术基建

### 2.1 依赖

| 依赖                                | 用途                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| `tailwindcss` + `@tailwindcss/vite` | Tailwind v4（Vite 插件方式接入，无需 postcss 配置）      |
| `shadcn-vue` CLI                    | 生成 `src/components/ui/*` 组件（基于 reka-ui）          |
| `lucide-vue-next`                   | 图标（shadcn 官方搭配，替换现有 `ui/Icon.vue` 手绘 SVG） |
| `vue-sonner`                        | Toast（shadcn-vue 官方推荐方案）                         |

```bash
npx shadcn-vue@latest init    # style: new-york，baseColor: neutral，cssVariables: yes
```

### 2.2 文件结构约定

```
src/
  components/
    ui/          # shadcn-vue 生成的基础组件（button、input、dialog…，不再放手写组件）
    biz/         # 业务组件（StatusCard、QuotaCard、ArmedButton、SegTabs…，基于 ui/ 组装）
    views 不变   # PopupView / OptionsView / AuthView / 门禁等，路径不动
  lib/utils.ts   # cn()（shadcn CLI 自动生成）
  styles/
    tokens.css   # 精简为：@import "tailwindcss" + @theme + :root/.dark 变量 + 少量全局样式
```

### 2.3 暗色模式机制

shadcn 约定用 `.dark` 类。为兼容现有 `[data-theme='dark']`，选择器写成两者并列：

```css
.dark,
[data-theme='dark'] {
  /* 暗色变量 */
}
```

不做主题切换 UI；`<html>` 上当前如何设 data-theme，重写后保持不变。

### 2.4 图标替换（Icon.vue → lucide-vue-next）

| 现有 name                                                                                                                                                              | lucide 组件                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| bookmark / star / plus / copy / list / lock / mail / user / folder / help / info / pencil / monitor / laptop / phone / globe / eye / eye-off / external-link / log-out | 同名驼峰：`Bookmark` `Star` `Plus` `Copy` `List` `Lock` `Mail` `User` `Folder` `CircleHelp` `Info` `Pencil` `Monitor` `Laptop` `Smartphone` `Globe` `Eye` `EyeOff` `ExternalLink` `LogOut` |
| check                                                                                                                                                                  | `Check`                                                                                                                                                                                    |
| check-circle                                                                                                                                                           | `CircleCheck`                                                                                                                                                                              |
| alert                                                                                                                                                                  | `CircleAlert`                                                                                                                                                                              |
| refresh / sync                                                                                                                                                         | `RefreshCw`                                                                                                                                                                                |
| chevron-right / chevron-left                                                                                                                                           | `ChevronRight` / `ChevronLeft`                                                                                                                                                             |
| cloud-slash                                                                                                                                                            | `CloudOff`                                                                                                                                                                                 |
| shield                                                                                                                                                                 | `ShieldCheck`                                                                                                                                                                              |
| gear                                                                                                                                                                   | `Settings`                                                                                                                                                                                 |
| trash                                                                                                                                                                  | `Trash2`                                                                                                                                                                                   |

尺寸规则沿用现状：行内图标 20px（`size-5`）、按钮内 18px（`size-4.5`）、chevron/ext 16px（`size-4`）、stroke-width 统一 1.75。

---

## 3. 设计 Token（亮 / 暗双主题，HSL）

### 3.1 shadcn 语义变量（:root 亮色 / .dark 暗色）

现有品牌主色是近黑（#0a0a0a），与 shadcn 官方 neutral 主题几乎同构，**直接按 neutral 基底映射**，不引入彩色主色。

| shadcn 变量                | 亮色 (HSL)   | 暗色 (HSL)   | 映射来源 / 说明                                                                      |
| -------------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------ |
| `--background`             | `0 0% 100%`  | `240 6% 4%`  | `--bg`（暗 #09090b）                                                                 |
| `--foreground`             | `0 0% 4%`    | `240 6% 96%` | `--text-primary`（#0a0a0a / #f5f5f7）                                                |
| `--card`                   | `60 5% 96%`  | `240 4% 11%` | `--bg-elevated`（#f6f6f4 / #1c1c1e）。**偏离 shadcn 默认**：现有卡片是灰底无框，保留 |
| `--card-foreground`        | `0 0% 4%`    | `240 6% 96%` | 同 foreground                                                                        |
| `--popover`                | `0 0% 100%`  | `240 4% 11%` | 弹层底色（现有 modal 用毛玻璃，见 §3.4）                                             |
| `--popover-foreground`     | `0 0% 4%`    | `240 6% 96%` | —                                                                                    |
| `--primary`                | `0 0% 4%`    | `240 6% 96%` | `--brand`。近黑主按钮，暗色反转                                                      |
| `--primary-foreground`     | `0 0% 98%`   | `240 6% 4%`  | `--brand-foreground`                                                                 |
| `--secondary`              | `60 5% 96%`  | `240 4% 11%` | `--btn-secondary-bg`                                                                 |
| `--secondary-foreground`   | `0 0% 4%`    | `240 6% 96%` | —                                                                                    |
| `--muted`                  | `60 4% 93%`  | `240 3% 17%` | `--bg-inset`（#ececea / #2c2c2e）                                                    |
| `--muted-foreground`       | `0 0% 44%`   | `240 4% 63%` | `--text-secondary`（#6f6f6f / #a1a1a6，白底对比 4.6:1 ✓）                            |
| `--accent`                 | `0 0% 94%`   | `240 6% 12%` | `--btn-ghost-bg-hover`（≈ rgba 黑 6% 叠白底）                                        |
| `--accent-foreground`      | `0 0% 4%`    | `240 6% 96%` | —                                                                                    |
| `--destructive`            | `4 100% 59%` | `4 90% 58%`  | `--danger-fill`（#ff3b30 / #ff453a）                                                 |
| `--destructive-foreground` | `0 0% 100%`  | `0 0% 100%`  | —                                                                                    |
| `--border`                 | `60 6% 91%`  | `240 3% 17%` | `--border`（#e8e8e6 / #2c2c2e）                                                      |
| `--input`                  | `60 5% 84%`  | `240 3% 23%` | `--border-strong`（#d8d8d6 / #3a3a3c）                                               |
| `--ring`                   | `0 0% 4%`    | `240 6% 96%` | 现有 focus ring 是黑（暗色白），同色                                                 |

**关于 `--tertiary` 级文字**：现有 `--text-tertiary`(#767676)、`--text-quaternary`(#a3a3a3)、`--text-disabled`、`--text-placeholder` 不入 shadcn 语义变量，作为扩展 token 保留（见 §3.3）。#a3a3a3 对比度仅 2.5:1，**只允许用于装饰性图标（chevron、win-dots），不得承载正文**——这条是现状规则的成文化。

### 3.2 状态色扩展（shadcn 没有的部分）

shadcn 只有 destructive。现有 success / warning / info 三套 tint 体系（badge、banner、statuscard、quota 都在用）作为扩展变量保留：

| 变量               | 亮色                     | 暗色                     | 来源                       |
| ------------------ | ------------------------ | ------------------------ | -------------------------- |
| `--success`        | `135 59% 49%` (#34c759)  | `135 59% 49%`            | `--success-fill`           |
| `--success-text`   | `135 60% 30%` (#1e7a34)  | `135 74% 51%` (#30d158)  | `--success-text`           |
| `--success-tint`   | `135 45% 95%` (#eaf7ee)  | `135 59% 49% / 14%`      | `--success-tint`           |
| `--success-border` | `135 50% 85%` (#c7e9cf)  | `135 59% 49% / 30%`      | `--success-border`         |
| `--warning`        | `35 100% 50%` (#ff9500)  | `48 100% 51%` (#ffd60a)  | `--warning-fill`           |
| `--warning-text`   | `43 100% 30%` (#9a6700)  | `48 100% 51%`            | 同上成对                   |
| `--warning-tint`   | `44 100% 95%` (#fff6e5)  | `48 100% 51% / 14%`      | —                          |
| `--warning-border` | `44 87% 81%` (#f6dfa6)   | `48 100% 51% / 30%`      | —                          |
| `--info`           | `211 100% 50%` (#007aff) | `211 100% 52%` (#0a84ff) | `--info-fill` / `--accent` |
| `--info-text`      | `211 100% 40%` (#0066cc) | `211 100% 52%`           | —                          |
| `--info-tint`      | `211 100% 96%` (#eaf3ff) | `211 100% 52% / 16%`     | —                          |
| `--info-border`    | `211 93% 88%` (#c5defb)  | `211 100% 52% / 32%`     | —                          |

`--info` 兼任现有的 `--accent`(#007aff) 选中高亮（BindSpaceGate 选中卡片边框等），重写后统一引用 `--info`，删除 `--accent` 这个歧义命名。

危险操作的 armed 色（`--danger-armed` #d92d20）保留为 `--danger-armed` / `--danger-armed-hover`。

### 3.3 字体、字号、间距、圆角、阴影、动效

**字体**：保持现有栈（SF Pro / PingFang SC 优先），通过 Tailwind v4 `@theme` 注册为 `--font-sans` / `--font-mono`，替换 Tailwind 默认。

**字号**：保留现有 px 级别（body 15px），映射进 `@theme`：

| token              | 现有                      | Tailwind 类名            |
| ------------------ | ------------------------- | ------------------------ |
| `--text-title-lg`  | 17px / lh 22 / ls -0.02em | `text-title-lg`          |
| `--text-title`     | 15px / lh 20              | `text-title`             |
| `--text-body`      | 15px / lh 21              | `text-body`（body 默认） |
| `--text-secondary` | 13px / lh 18              | `text-secondary`         |
| `--text-caption`   | 12px / lh 16              | `text-caption`           |
| `--text-badge`     | 11px                      | `text-badge`             |

> shadcn 组件内部默认 `text-sm`(14px)。为避免逐个覆盖，接受表单类组件（Input/Textarea）用 14px 的差异；正文区一律用上面的自定义类。settings 页标题 22px 保留为一次性 `text-[22px] tracking-[-0.02em]`。

**字重**：400 / 500 / 600 / 700，直接用 Tailwind `font-medium` / `font-semibold` / `font-bold`。

**间距**：现有 `--space-*`(4/8/12/16/20/24/32) 与 Tailwind 数字刻度一一对应（1/2/3/4/5/6/8），直接用 Tailwind 类，不再保留 CSS 变量。布局常量保留：

- popup：宽 400px、高 600px、内边距 x16/y14、块间距 12px → `App.vue` 的 `body.popup` 与 `PopupView` 内联；
- options：导航宽 220px、内容区 max-width 620px、内边距 24/32/48。

**圆角**：`--radius: 10px` 为基准（对应现 radius-md），派生按 shadcn 惯例：`xs`=6、`sm`=8（radius-2）、`md`=10、`lg`=12（radius+2）、`xl`=16（radius+6）、`frame`=14、`full`=999。shadcn 组件类名（`rounded-md` 等）自动对齐，无需改动组件代码。

**阴影**：四个层级保留为 Tailwind `@theme` token：`shadow-raised`（卡片）、`shadow-popover`、`shadow-modal`、`shadow-toast`，亮暗值沿用现 tokens.css。

**动效**：duration 100/160/240/320ms、缓动曲线（standard/decelerate/spring 等）作为 `@theme` 的 `--ease-*` / `--duration-*` 保留；`prefers-reduced-motion` 全局降级规则原样保留。

**z-index**：sticky 100 / popover 200 / modal 300 / toast 400，保留。

**不进 Tailwind 体系的保留样式**（全局 CSS，留在 tokens.css 尾部）：

- 毛玻璃材质（`--material-*` + backdrop-filter）：升级弹窗与 overlay 用，无 Tailwind 等价物；
- 统一滚动条（8px、`--border-strong` thumb、全圆角）；
- `:focus-visible` 双环规则（`0 0 0 2px bg, 0 0 0 4px fg/55%`）——保留现有实现，shadcn 组件自带的 ring 样式会被这条全局规则覆盖，效果一致；
- `svg` 兜底尺寸与 `overflow-x: hidden` 规则原样保留。

---

## 4. 组件映射表

现状 = tokens.css 里的原子类 + `components/ui/` 手写组件。目标 = shadcn-vue 组件 + `components/biz/` 业务组件。

### 4.1 基础原子

| 现状                                                        | 目标                                                                      | 处理方式                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.btn` + `.btn-primary`                                     | `Button` variant `default`                                                | 直接用；size 映射：lg→自定义 `xl`（h-11 全宽）、md→`default`（h-9）、sm→`sm`（h-8）                                                                                                                                                         |
| `.btn-secondary`                                            | `Button` variant `secondary`                                              | 直接用                                                                                                                                                                                                                                      |
| `.btn-ghost`                                                | `Button` variant `ghost`                                                  | 直接用                                                                                                                                                                                                                                      |
| `.btn-destructive`                                          | `Button` 自定义 variant `outline-destructive`                             | **需定制**：shadcn 默认 destructive 是实底红，现状是「透明底+红字+红边框」。在 button.ts 加 variant（`border-destructive/30 text-destructive hover:bg-destructive-tint`）                                                                   |
| `.btn-armed`（脉冲红）                                      | `ArmedButton`（biz）                                                      | 保留业务组件，内部改用 `outline-destructive` variant + `animate-armed`（keyframes 迁到 Tailwind `@theme`）                                                                                                                                  |
| `.btn-done`                                                 | `Button` variant `secondary` + success 覆写类                             | 一次性用法，不建 variant                                                                                                                                                                                                                    |
| `.icon-btn`                                                 | `Button` variant `ghost` size `icon-sm`                                   | 自定义 size（32×32，shadcn 默认 icon 是 36）                                                                                                                                                                                                |
| `.spinner`                                                  | `LoaderCircle` + `animate-spin`                                           | 删自绘 spinner；加载态统一「图标 + animate-spin」                                                                                                                                                                                           |
| `.field` + label                                            | `Field` + `FieldLabel`（shadcn Field 族）                                 | 直接用；无 Field 版本时用 `Label` + flex col gap-1.5                                                                                                                                                                                        |
| `.hint-error`                                               | `FieldError`（或 `FieldDescription` + `text-destructive`）                | 直接用                                                                                                                                                                                                                                      |
| `.input`                                                    | `Input`                                                                   | 现状 `is-error` 状态 → `aria-invalid`（shadcn Input 内建红色态）。`.is-focus` 由浏览器 focus 全局规则接管                                                                                                                                   |
| `.textarea`                                                 | `Textarea`                                                                | 同上                                                                                                                                                                                                                                        |
| `.badge` 5 色                                               | `Badge`：neutral→`secondary`；success/danger/warning/info→自定义 variants | 在 badge.ts 扩展三个 tint variants                                                                                                                                                                                                          |
| `.seg` / `SegTabs.vue`                                      | `SegTabs`（biz），基于 shadcn 无现成分段控件                              | **需定制**：保留 radiogroup 语义与 roving tabindex（现实现是对的），视觉改为 shadcn 风（muted 底、白 thumb、`shadow-raised`）。可用 `ToggleGroup type="single"` 做底座，但要注意它不输出 radiogroup 语义——保留手写结构更稳                  |
| `.switch`                                                   | `Switch`（shadcn）                                                        | **现状无任何组件使用 switch**，token 是预留。接入时用 shadcn 默认样式（on 色 = primary 黑，不再用 iOS 绿）                                                                                                                                  |
| `.progress`                                                 | `Progress`                                                                | warn/over 两种 indicator 颜色作为 className 覆写传入（`[&>div]:bg-warning`）                                                                                                                                                                |
| `.toast` / `ToastHost.vue`                                  | `vue-sonner` `Toaster`                                                    | position `bottom-center`；level → type 映射 success/error/info；左侧 3px 色条与阴影用 `toastOptions.class` 定制；`<Toaster>` 挂 `App.vue` 替换 `ToastHost`；`store.js` 的 `pushToast` 改调 `toast()`（唯一允许触碰 store 的一处，签名不变） |
| `.banner` 4 色                                              | `Alert`：destructive→danger；success/warning/info→自定义 variants         | 在 alert.ts 扩展，图标沿用现状选型                                                                                                                                                                                                          |
| `.card`                                                     | `Card`                                                                    | 现状卡是灰底无边框，shadcn 默认白底+边框——**统一改为 `bg-card`（灰底）无边框**，在 Card 上覆写一次                                                                                                                                          |
| `.overlay` + `.modal`                                       | `Dialog`（`DialogOverlay` + `DialogContent`）                             | Overlay 覆写为 `bg-black/40 backdrop-blur-sm`；Content 覆写为毛玻璃材质（`bg-white/92 backdrop-blur-[20px]` + `shadow-modal`，暗色对应）+ `rounded-xl p-5`；宽度保留 `min(320px, 100%-32px)`                                                |
| `.m-ico`                                                    | DialogIcon（biz，40px tint 块）                                           | info/warning/danger 三色，10 行小组件                                                                                                                                                                                                       |
| `.acc` 手风琴                                               | `Accordion` type `single` `collapsible`                                   | 内容含 HTML（i18n 带 `<table>`），用 `AccordionContent` 包 `v-html`，`help-tbl` 表格样式保留为全局 CSS                                                                                                                                      |
| `.opt-nav`                                                  | 自建导航（不用 shadcn Sidebar，过重）                                     | nav item = `Button` variant ghost + active 态（`bg-primary text-primary-foreground`）                                                                                                                                                       |
| `.avatar`                                                   | `Avatar` + `AvatarFallback`（首字母）                                     | 直接用                                                                                                                                                                                                                                      |
| `kbd`                                                       | 保留全局样式                                                              | Tailwind 化即可                                                                                                                                                                                                                             |
| `.key-box` / `.kp-block`（密钥展示）                        | 组合：`Input` readonly mono + `Button` ghost size icon-sm（eye/copy）     | 无现成组件，组合即可                                                                                                                                                                                                                        |
| `BindSpaceGate` 选项卡                                      | `RadioGroup` + `RadioGroupItem` + 卡片样式                                | 选中态边框 `border-info` + `bg-black/6`；「覆盖本机」标题 `text-destructive`                                                                                                                                                                |
| `.popup-chrome` / `.drawer-chrome` / `win-dots` / `ext-ico` | PopupChrome（biz）                                                        | 纯业务装饰组件，非 shadcn 范畴，Tailwind 化保留                                                                                                                                                                                             |

### 4.2 业务组件（`components/biz/`）

| 组件                         | 现状                             | 重写要点                                                                                                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StatusCard`                 | `.statuscard` ok/info/error 三态 | 基于 `Item` 族（见下）+ 语义色；error 态整卡 `bg-destructive-tint` + 红图标 + ghost retry 按钮；syncing 态图标换 `LoaderCircle animate-spin`                                                                                                                                                        |
| `QuotaCard`                  | `.quota` + warn/over 变体        | `Card` + `Badge`（状态徽标）+ `Progress`（warn/over 色）+ `Button` ghost sm（升级/管理）；warn/over 整卡 tint 背景同现状                                                                                                                                                                            |
| `ArmedButton`                | 两步确认按钮                     | 保留 API（label/confirmLabel/armed/countdown/@press），样式换 `outline-destructive`；armed 态 `animate-armed` 脉冲                                                                                                                                                                                  |
| `SegTabs`                    | 分段控件                         | 保留 radiogroup + 方向键语义，视觉 shadcn 化（§4.1）                                                                                                                                                                                                                                                |
| `SpacesList` / `DevicesList` | `.inset-group`/`.inset-row` 列表 | 底座用 shadcn-vue 的 **Item 组件族**（`ItemGroup`/`Item`/`ItemMedia`/`ItemContent`/`ItemTitle`/`ItemDescription`/`ItemActions`）——与 inset-group/inset-row 一一对应；若所用 shadcn-vue 版本还没有 Item 族，则自建 `ListGroup`/`ListRow`（biz，分隔线 `border-subtle`、hover `bg-accent`、min-h-11） |
| `KeyPanel`                   | 密钥掩码展示                     | 组合方案见 §4.1；掩码/揭示逻辑与「打开即隐藏」行为原样保留                                                                                                                                                                                                                                          |
| `FeedbackForm`               | 表单                             | `Field` + `Textarea` + `Input` + `SegTabs` + `Button`；结果 banner → `Alert`                                                                                                                                                                                                                        |
| `ModalUpgrade`               | 升级弹窗                         | `Dialog` + `PlanCard`（biz）：reco 态 1.5px 主色内描边 + 「推荐」`Badge` secondary；价格 mono 字体保留                                                                                                                                                                                              |

### 4.3 不需要引入的 shadcn 组件

`DropdownMenu`、`Select`、`Table`、`Tabs`（页面导航是自建 nav，非内容面板）、`Tooltip`、`Command`、`DataTable`——现状没有对应交互，**不要为了用而用**。

---

## 5. 关键界面布局说明

所有界面共用：字体栈、语义 token、`Item`/列表规范、焦点环。以下「组件」均指 §4 映射后的目标组件。

### 5.1 AuthView（登录/注册，popup 与 options 复用）

```
┌ PopupChrome（图标 B + 名称 + win-dots）36px ┐
│ brandmark 48px 圆角块 + h1 title-lg + sub    │
│ SegTabs（登录 | 注册）                       │
│ Field×2：邮箱 Input / 密码 Input(password)   │
│ Button default xl 全宽（busy→LoaderCircle）  │
│ [Alert success 成功态] / [Alert destructive] │
│ auth-hint caption 居中（含 kbd 快捷键提示）   │
│ 底部 footer：忘记密码 | 帮助 | 邮件反馈(外链) │
└─（options 内嵌时无 chrome，居中 360px 列）────┘
```

状态：busy 禁用+spinner；成功/失败 Alert 可并存前清空对方；Enter 提交；失败不清空输入。

### 5.2 PhraseGate（口令门禁，整页不可关闭）

居中 360px 卡片列：56px 圆形 scrim 底 shield 图标 → 标题（setup/verify 两套文案）→ 说明 → 密码 Input + Button default（同行堆叠，输入为空禁用）→ 错误文案 `text-destructive` caption。无返回路径，不渲染 chrome。

### 5.3 BindSpaceGate（首绑门禁，整页不可关闭）

居中 420px 列：48px info-tint 圆底 bookmark 图标 → 标题 + 说明（含本机书签数）→ `RadioGroup`（空间列表，默认空间带 neutral Badge；付费档额外有「新建空间」项，选中展开 Input + 取消 ghost sm）→ 本机有书签时显示去向 `RadioGroup`（并入 / 覆盖，覆盖标题红）→ 底部动作：普通走 `Button default` 全宽；覆盖走 `ArmedButton`（两步确认 + 3s 倒计时）→ 底部 caption 提示「必须选择」。
状态：bindBusy 全组禁用；无合法选择时 CTA 禁用。

### 5.4 Popup 主屏（400×600 固定）

```
┌ PopupChrome 36px ──────────────────────────┐
│ popup-body（gap-3 px-4 py-3.5，overflow-y） │
│  StatusCard（ok/syncing/error 三态）         │
│  [Alert info：未配置同步密钥时出现]           │
│  QuotaCard（徽标+用量+进度条+升级/管理）       │
│  Button default xl：立即同步                  │
│   ├ busy → 禁用 + LoaderCircle +「同步中」    │
│   ├ 上次失败 → 图标 RefreshCw +「重新同步」    │
│  ItemGroup：账户(尾注套餐/会员) / 帮助 /       │
│   去评分(尾图标 ExternalLink，开商店页) /      │
│   反馈 / 系统(尾注 vX.Y.Z)                    │
│  popup-foot：居中 caption 链接组（分隔竖线）   │
└────────────────────────────────────────────┘
```

### 5.5 抽屉（popup 二级面板，`state.drawer` 驱动，无路由）

```
┌ DrawerChrome：ChevronLeft icon-btn + 标题 ──┐
│ drawer-body（gap-3.5，同 popup-body 滚动）   │
│  按 drawer 挂：SpacesDrawer（SpacesList+     │
│  DevicesList）/ KeyPanel / PaneAccount bare  │
│  / PaneFeedback bare / PaneSystem bare /     │
│  PaneHelp bare                              │
└─────────────────────────────────────────────┘
```

`bare` 约定保留：抽屉内组件不渲染自己的 h2/h4（标题由 chrome 承载）。

### 5.6 Options 设置页

未登录：内容区居中 360px 列放 AuthView（无 chrome）。
已登录：左 220px 导航（`nav-title` uppercase caption + 7 个 nav item：账户/同步/空间/加密/帮助/反馈/系统）+ 右内容区（max-w-[620px]）。

各 pane 结构（`grp` 分组间距 22px，组标题 caption uppercase）：

- **PaneAccount**：`ItemGroup`（64px 头行：`Avatar` 首字母 + 昵称/邮箱 + 退出 secondary sm；套餐行：标题/说明 + Badge + 升级 ghost sm）
- **PaneSync**：`ItemGroup` 3 行（自动同步=常开 Badge success；冲突=内置 Badge neutral；立即同步=副行显示上次时间与已用空间 + `Button default sm` 带 busy spinner）+ foot 说明
- **PaneSpaces**：`SpacesList`（行内改名：Input + 保存 secondary sm / 取消 ghost sm；删除走 `ArmedButton`；换绑确认条：背景 scrim + 全文后果说明 + `outline-destructive` sm + 取消；新建行同模式）+ `DevicesList`（改名同上；「本机」`Badge` info；断开走 `ArmedButton`；空态 = `Alert` info「暂无其他设备」）+ foot
- **PaneCrypto**：`KeyPanel`（顶部 `Alert` info 端到端说明 + 掩码密钥框 + eye/copy）
- **PaneHelp**：`Accordion` 7 条，内容含表格（`help-tbl` 样式保留）
- **PaneFeedback**：`FeedbackForm`（类型 SegTabs bug/idea/other + 正文 Textarea(maxlength 2000, 失败红框 aria-invalid) + 可选邮箱 Input + 提交 Button default busy 态 + 结果 Alert + 环境/隐私 foot + GitHub Issues 外链）
- **PaneSystem**：`ItemGroup` 单行版本号

### 5.7 ModalUpgrade（升级弹窗）

`Dialog`（宽 min(320px, 100%-32px)，毛玻璃）：`DialogIcon` info(shield) → 标题 → 正文（已用 N 条）→ 纵向两张 `PlanCard`：Plus（$20/年）/ Pro（$50/年 + 推荐 Badge + 主色描边），各含 3 条特性（`Check` success 16px）+ 订阅 Button（secondary / default，busy 态）→ 底部 ghost「以后再说」。
overlay 点击关闭（`.self`），Esc 关闭由 Dialog 自带；checkout busy 期间两个订阅按钮同禁。

### 5.8 Toast

`vue-sonner`，`position="bottom-center"`，底部 20px 偏移，多条纵向堆叠 gap 8px。样式：灰底（`bg-card`）圆角 `rounded-md` 阴影 `shadow-toast`，左侧 3px 语义色条，图标 18px（CircleCheck/CircleAlert/Info），标题 13px semibold + 副文 12px muted。语义：success/error/info（danger→error）。

### 5.9 加载 / 空 / 错误态约定（全局）

| 场景       | 表现                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 门禁判定中 | `boot-splash`：居中 `LoaderCircle animate-spin`，不闪主界面                                                                                         |
| 按钮 busy  | 禁用 + 图标位换 `LoaderCircle` + 文案换「进行中」态（syncing/submitting/checkout 等，i18n key 现成）                                                |
| 列表空     | `Alert` info（如设备空态），不渲染空 `ItemGroup`                                                                                                    |
| 请求失败   | 就地 `Alert` destructive（表单/登录）或整卡 error 态（StatusCard），配 retry 入口；Toast 只用于后台动作结果                                         |
| 破坏性操作 | 一律 `ArmedButton` 两步确认（删除空间/断开设备/覆盖本机）或确认条（换绑）；不新增裸删除入口                                                         |
| 键盘       | 焦点环全局规则（§3.3）；SegTabs 方向键 roving；Input Enter 提交、Esc 取消改名；Dialog Esc 关闭；`hit-slop` 6px 扩大热区保留在 icon-btn/seg/link-btn |
| 小屏       | popup 固定 400×600 内部滚动（`scroll-y` 行为保留）；options 内容区自然收缩，导航在 <760px 时可后续再议（现状无处理，不新增）                        |

---

## 6. 实施顺序建议（给开发）

1. **基建**：Tailwind v4 接入 + `shadcn-vue init` + tokens（§3）+ 全局保留样式（§3.3）+ lucide 图标替换 `Icon.vue`（映射表 §2.4）。验收：老组件在 Tailwind preflight 下不塌。
2. **原子层**：Button/Input/Textarea/Label/Field/Badge/Alert/Progress/Dialog/Accordion/Avatar/Switch/Item 族生成 + 定制 variants（§4.1）+ `vue-sonner` 接管 Toast。
3. **业务层**：biz 组件逐个迁移（PopupChrome → ArmedButton → SegTabs → StatusCard/QuotaCard → ListGroup/Item 应用 → PlanCard/DialogIcon）。
4. **视图层**：PopupView → 抽屉 → OptionsView 七 pane → AuthView → 三道门禁 → ModalUpgrade。
5. **收尾**：删 tokens.css 死代码、`npm run check`（typecheck+lint+fmt+test）全绿、e2e 通过、暗色主题肉眼过一遍每个界面。

每步完成后插件应可构建可运行，不允许出现「中间态不可用」的提交。

## 7. 验收清单

- [ ] 视觉：亮/暗双主题下 popup 与 options 全界面无样式崩坏；毛玻璃弹窗在不支持 backdrop-filter 的环境回落纯色（现有 @supports 规则保留）
- [ ] token：无残留的旧语义类（`btn-*`、`inset-*`、`badge-*` 等）出现在 SFC 中
- [ ] 交互：登录/同步/建空间/改名/删除（armed）/换绑（确认条）/升级 checkout/反馈提交 全链路可用
- [ ] 状态：每个界面的 busy/empty/error 态可见且文案来自 i18n（key 不改）
- [ ] 无障碍：radiogroup/focus ring/aria-label/aria-live(toast)/reduced-motion 全部保留
- [ ] 对比度：正文 ≥4.5:1；#a3a3a3 级灰色仅用于装饰图标
