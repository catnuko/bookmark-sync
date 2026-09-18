# Changelog

## [2.2.0](https://github.com/catnuko/bookmark-sync/compare/v2.1.0...v2.2.0) (2026-09-18)


### Features

* **sync:** GC 服务端托管——用户动态阈值自动压缩，插件移除 GC 设置，后台支持监控/调阈值/请求压缩 ([a73c903](https://github.com/catnuko/bookmark-sync/commit/a73c903b52efeb067d1fd81310319ee45e3c7ccc))


### Bug Fixes

* **sync:** 解密失败时跳过 GC，防止残缺快照截断导致云端 op 永久丢失 ([eb48a53](https://github.com/catnuko/bookmark-sync/commit/eb48a539caa6cfd59034f67dd00bbe1e606edefc))
* **website:** 修复官网落后插件 v2.1.0 的内容 ([e616fa0](https://github.com/catnuko/bookmark-sync/commit/e616fa0b204fdac3ca367e132af82bb1bbf4fa26))

## [2.1.0](https://github.com/catnuko/bookmark-sync/compare/v2.0.0...v2.1.0) (2026-09-17)


### Features

* **admin:** 后台管理系统 /admin 子站 ([5dce45f](https://github.com/catnuko/bookmark-sync/commit/5dce45f25dabc4d7ed7c51cadfe472a82f45a526))
* **e2ee:** 口令模式补全——salt 云端流转，跨设备只需记住口令 ([e1111ca](https://github.com/catnuko/bookmark-sync/commit/e1111caf2d6cc58aa0daefd8f71031f5f3aaa67e))
* **menu:** Chromium 端「书签菜单」容器按需存在——菜单有书签才显示 ([45d1128](https://github.com/catnuko/bookmark-sync/commit/45d11281eaa96ba4a89792672529bdf67c4dd6d4))
* **ui:** 口令模式强提醒——忘记口令 = 数据丢失 ([bb072bc](https://github.com/catnuko/bookmark-sync/commit/bb072bc548875417721d7a4eb4d689e4c4a766df))
* **ui:** 新设备密钥引导 + 帮助面板 + 首次同步自动创建默认空间 ([748251f](https://github.com/catnuko/bookmark-sync/commit/748251fa5cf0630fe90c122a7e51a4ccb27a49bc))
* **ui:** 登录表单记住上次邮箱，退出后自动填充（密码不落盘） ([379e0b8](https://github.com/catnuko/bookmark-sync/commit/379e0b8912acca151c12e76adc958b30e47ca626))
* 修复pnpm安装问题 ([1f3be5c](https://github.com/catnuko/bookmark-sync/commit/1f3be5c2f32d3bc31e41fef92fdc276ac9a242bd))
* 口令门禁——登录后必须输入口令才能进主界面 ([7354e25](https://github.com/catnuko/bookmark-sync/commit/7354e25fc1c25a06bce93429b2966b186a02bb4e))
* 同步只走口令，去掉自动生成的 44 位密钥 ([ef0fcab](https://github.com/catnuko/bookmark-sync/commit/ef0fcab35fb4a35727e03356b38457e81df1e7f9))
* 清空测试数据移入后台管理；高级/帮助移入弹窗，设置页改为品牌占位 ([3344342](https://github.com/catnuko/bookmark-sync/commit/334434236376e99e07b2201511d6c4377d8f83a0))


### Bug Fixes

* **admin:** 移除误加的卡密模块 ([4748db6](https://github.com/catnuko/bookmark-sync/commit/4748db689759a44543a74c260503bde127ffca98))
* **sync:** 修复删除同步在 SW 冷启动下失效（事件懒启动 + 计数器恢复 + 推送失败保留） ([d81e659](https://github.com/catnuko/bookmark-sync/commit/d81e659ca4c0d4bc353540234658ab53f3ac01a8))
* **sync:** 修复双设备同步数据丢失 + 完善调试工具 ([04bf96a](https://github.com/catnuko/bookmark-sync/commit/04bf96ab5900906679fe60f3ac413710730bd704))
* **sync:** 删除「书签菜单」容器同步失效——墓碑化 MENU_UUID + 残留映射防报错 + 同步期删除排队 ([425b971](https://github.com/catnuko/bookmark-sync/commit/425b97185b7900f16f04ebcfe3684a80b13cbd87))
* **sync:** 删除「书签菜单」改为清空内容、保留位置——Firefox 菜单保持跨设备同步 ([9e69c2e](https://github.com/catnuko/bookmark-sync/commit/9e69c2e5dc6247c6b2cb459d62393464fb4358a3))
* **sync:** 同步前确保 supabase 会话就绪——避免 SW 冷启动以 anon 调用 RPC ([3afd01d](https://github.com/catnuko/bookmark-sync/commit/3afd01d9f35c22dc5ec38aea4b0386156da22ffc))
* **sync:** 菜单容器误删与冷启动事件丢失 ([1f3914a](https://github.com/catnuko/bookmark-sync/commit/1f3914a93518021dc1fdde3938bdd0ab11a2fc05))
* **sync:** 顺序层接线——fractional position 全路径写入，同步不再按 uuid 重排 ([23ecff9](https://github.com/catnuko/bookmark-sync/commit/23ecff948b0083dbe3464bd6a4aa3bc1fd123796))
* **ui:** 移除明文同步开关，同步强制端到端加密 ([a2b48c2](https://github.com/catnuko/bookmark-sync/commit/a2b48c2f05ff316af012202f59276db2363e0be3))
* 修复多空间配额/默认空间保护前端错误映射 ([a27b7ed](https://github.com/catnuko/bookmark-sync/commit/a27b7ed59d1f2b128daf12077093c3d6e63d2bca))
* 口令设置后立即上传新生成的盐到云端 ([83701dd](https://github.com/catnuko/bookmark-sync/commit/83701dd912634e80927576f62e000ac19f3d4d5d))
* 同步结果不再展示 CRDT op 条数，改用自然语言 ([3963e2d](https://github.com/catnuko/bookmark-sync/commit/3963e2d2ba1b5027a436fe6b095b493ab911c52f))
* 新设备首次从云端恢复时显示正确文案 ([edd7ec8](https://github.com/catnuko/bookmark-sync/commit/edd7ec8d29df4bd807b705aacb71f054ff70b672))
* 自动同步后通知 popup 刷新书签数和状态 ([c33b13d](https://github.com/catnuko/bookmark-sync/commit/c33b13d3f228fe0ab96857ced5757eefd8e3e383))
* 首次同步提示只在本次真的播种时出现 ([0e8363b](https://github.com/catnuko/bookmark-sync/commit/0e8363b8ba26e8b491e99a9b1182c449f08f4007))

## [1.1.0](https://github.com/catnuko/bookmark-sync/compare/v0.1.0...v1.1.0) (2026-09-13)


### Features

* GitHub Action 自动打包发布插件 ([728a3da](https://github.com/catnuko/bookmark-sync/commit/728a3dae218108445507ca7ee2dc00bb325e1131))
* GitHub Action 自动打包发布插件 ([a9a5678](https://github.com/catnuko/bookmark-sync/commit/a9a5678bf7df3a7b01e24f5fdb89a654ce34b316))
* **pricing:** 定价补充空间/设备维度，生产域名切换为 www.bookmark-sync.top ([e10efe9](https://github.com/catnuko/bookmark-sync/commit/e10efe93e8ad53f89561124a7c102a630acc86a2))
* Supabase 本地代码驱动规则配置 ([40919d3](https://github.com/catnuko/bookmark-sync/commit/40919d31f181585a4806943b00e12265f8df230a))
* Supabase 本地代码驱动规则配置 ([c0d9325](https://github.com/catnuko/bookmark-sync/commit/c0d9325ae34e4843670f3e2f9d186b596a1e6d8e))
* **website:** 官网接入登录 + Creem 订阅/取消订阅入口 ([8d4bdf4](https://github.com/catnuko/bookmark-sync/commit/8d4bdf46a664b573a0105f3e4d964b07041b39d9))
* 基线化远端 Supabase 现状到本地代码 ([1c64b11](https://github.com/catnuko/bookmark-sync/commit/1c64b1146376ed03bb8bf7f2bc4c6ddc8fd53d5b))
* 多同步空间与设备管理，多设备合并前知情确认 ([7957483](https://github.com/catnuko/bookmark-sync/commit/7957483a8623401b72cb9e59dda99e5b1bfeeaf6))
* 调研开源书签同步策略方案 ([6d015c6](https://github.com/catnuko/bookmark-sync/commit/6d015c66d56beb03083fd0b310e0fcfd1732882e))
* 调研开源书签同步策略方案 ([e2906c3](https://github.com/catnuko/bookmark-sync/commit/e2906c3b5d5d10affd167a822da52db3e7e4ad41))
* 调研开源书签同步策略方案 ([e1e79c3](https://github.com/catnuko/bookmark-sync/commit/e1e79c31fcba72b123a15756a49aff4ba96b6b92))
* 调研开源书签同步策略方案 ([e168d9b](https://github.com/catnuko/bookmark-sync/commit/e168d9b4846e891bc94e78b5ea0711586b0f4b1f))
* 调研开源书签同步策略方案 ([bbd80e0](https://github.com/catnuko/bookmark-sync/commit/bbd80e0b8aef91eb12ac8c5c33a555f5aa39a6f9))
* 调研开源书签同步策略方案 ([a9a0994](https://github.com/catnuko/bookmark-sync/commit/a9a09944027306a167b0b1e73e2c780fe33ec6a6))
* 调研开源书签同步策略方案 ([c95d364](https://github.com/catnuko/bookmark-sync/commit/c95d364328497b4444d6247c2f811500ebf10db7))
* 调研开源书签同步策略方案 ([ff72787](https://github.com/catnuko/bookmark-sync/commit/ff72787b46f29959f5364389311616ce192a368c))
* 迁移 0010 添加表/列/函数中文描述注释 ([d28a26d](https://github.com/catnuko/bookmark-sync/commit/d28a26d6785deca68a436c0cfc682e0cf313baf0))
* 重写官网文案与定价策略，突出真树同步与端到端加密 ([8a4f128](https://github.com/catnuko/bookmark-sync/commit/8a4f1285b84dcce424533174d204eba573cf1116))


### Bug Fixes

* **website:** 依赖入册 + 边缘函数更名同步 ([b4c416e](https://github.com/catnuko/bookmark-sync/commit/b4c416e51a6a752f6d99dd238cc8c7bb0639e7b5))
* 修复 i18n 邮箱 @ 被当链接语法导致页面渲染中断 ([cd23569](https://github.com/catnuko/bookmark-sync/commit/cd235698ef1888e35387eed6f9cb5abadd593e59))

## [0.1.0](https://github.com/catnuko/bookmark-sync/compare/v0.1.0...v0.1.0) (2026-09-11)


### Features

* GitHub Action 自动打包发布插件 ([2c05823](https://github.com/catnuko/bookmark-sync/commit/2c05823c1d3fd20ac2408e16c3188fcdc9302464))
* GitHub Action 自动打包发布插件 ([e3af705](https://github.com/catnuko/bookmark-sync/commit/e3af70559d506d28d8aa06629d998ed50675b2a9))
* Safari 移植（Xcode 工程 + 扩展同步/构建自动化）并排除编译产物 ([475d8c5](https://github.com/catnuko/bookmark-sync/commit/475d8c50539c51c59a161ec23344d0ba05c409c6))
* 多浏览器书签同步插件方案 ([0c75265](https://github.com/catnuko/bookmark-sync/commit/0c7526586ff63ccd982c6d6f36cb6a544df66862))
* 多浏览器书签同步插件方案 ([7548d16](https://github.com/catnuko/bookmark-sync/commit/7548d1616a55f5e9364cff67d75e6952f0d89b41))
* 多浏览器书签同步插件方案 ([c903520](https://github.com/catnuko/bookmark-sync/commit/c9035203368dc5dfab3c45aa8a97cbda8db11c85))
* 多浏览器书签同步插件方案 ([48e9ca8](https://github.com/catnuko/bookmark-sync/commit/48e9ca8a10dd33d4247802e527815e9b3fd05f62))
* 多浏览器书签同步插件方案 ([db15011](https://github.com/catnuko/bookmark-sync/commit/db15011a1c1d942fb4e2cbdc4c4e82f23937d9f3))
* 定价改为按书签条数的三档订阅（官网 + 插件文案） ([008b12a](https://github.com/catnuko/bookmark-sync/commit/008b12a7e5fe3c4a4005ecd2c9b04cd1d0f0646e))
* 快照+墓碑同步协议（1.1.0） ([3b3c029](https://github.com/catnuko/bookmark-sync/commit/3b3c02938d7a62d69647557dc68f3da0d041b370))
* 配置 Supabase MCP 服务 ([4bcfdd7](https://github.com/catnuko/bookmark-sync/commit/4bcfdd727a2965aca7eeea65cc23a16e0746dbc3))
* 配置 Supabase MCP 服务 ([d940ea8](https://github.com/catnuko/bookmark-sync/commit/d940ea8d7d81d86dad958c0dc7c13272120eb1b3))
* 配置 Supabase MCP 服务 ([a3843c9](https://github.com/catnuko/bookmark-sync/commit/a3843c9e3c59bb14d349d785ffca9729366c153a))


### Bug Fixes

* add pnpm-lock.yaml for website Vercel deploy ([afba51c](https://github.com/catnuko/bookmark-sync/commit/afba51c8f648455f468752ad4e2ae47d15069dfc))
* **ci:** add pull-requests scope for release-please ([c27deb2](https://github.com/catnuko/bookmark-sync/commit/c27deb27a60d339cbd28e565952618deb8b73eef))
* **ci:** pin pnpm version to 10 ([c41ec33](https://github.com/catnuko/bookmark-sync/commit/c41ec3338ec6f892abf3e985930baea3d93597ca))

## 0.1.0 (2026-09-11)


### Features

* GitHub Action 自动打包发布插件 ([2c05823](https://github.com/catnuko/bookmark-sync/commit/2c05823c1d3fd20ac2408e16c3188fcdc9302464))
* GitHub Action 自动打包发布插件 ([e3af705](https://github.com/catnuko/bookmark-sync/commit/e3af70559d506d28d8aa06629d998ed50675b2a9))
* Safari 移植（Xcode 工程 + 扩展同步/构建自动化）并排除编译产物 ([475d8c5](https://github.com/catnuko/bookmark-sync/commit/475d8c50539c51c59a161ec23344d0ba05c409c6))
* 多浏览器书签同步插件方案 ([0c75265](https://github.com/catnuko/bookmark-sync/commit/0c7526586ff63ccd982c6d6f36cb6a544df66862))
* 多浏览器书签同步插件方案 ([7548d16](https://github.com/catnuko/bookmark-sync/commit/7548d1616a55f5e9364cff67d75e6952f0d89b41))
* 多浏览器书签同步插件方案 ([c903520](https://github.com/catnuko/bookmark-sync/commit/c9035203368dc5dfab3c45aa8a97cbda8db11c85))
* 多浏览器书签同步插件方案 ([48e9ca8](https://github.com/catnuko/bookmark-sync/commit/48e9ca8a10dd33d4247802e527815e9b3fd05f62))
* 多浏览器书签同步插件方案 ([db15011](https://github.com/catnuko/bookmark-sync/commit/db15011a1c1d942fb4e2cbdc4c4e82f23937d9f3))
* 定价改为按书签条数的三档订阅（官网 + 插件文案） ([008b12a](https://github.com/catnuko/bookmark-sync/commit/008b12a7e5fe3c4a4005ecd2c9b04cd1d0f0646e))
* 快照+墓碑同步协议（1.1.0） ([3b3c029](https://github.com/catnuko/bookmark-sync/commit/3b3c02938d7a62d69647557dc68f3da0d041b370))
* 配置 Supabase MCP 服务 ([4bcfdd7](https://github.com/catnuko/bookmark-sync/commit/4bcfdd727a2965aca7eeea65cc23a16e0746dbc3))
* 配置 Supabase MCP 服务 ([d940ea8](https://github.com/catnuko/bookmark-sync/commit/d940ea8d7d81d86dad958c0dc7c13272120eb1b3))
* 配置 Supabase MCP 服务 ([a3843c9](https://github.com/catnuko/bookmark-sync/commit/a3843c9e3c59bb14d349d785ffca9729366c153a))


### Bug Fixes

* add pnpm-lock.yaml for website Vercel deploy ([afba51c](https://github.com/catnuko/bookmark-sync/commit/afba51c8f648455f468752ad4e2ae47d15069dfc))
* **ci:** add pull-requests scope for release-please ([c27deb2](https://github.com/catnuko/bookmark-sync/commit/c27deb27a60d339cbd28e565952618deb8b73eef))
