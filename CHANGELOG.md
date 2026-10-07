# Changelog

## [2.13.0](https://github.com/catnuko/bookmark-sync/compare/v2.12.0...v2.13.0) (2026-10-07)


### Features

* **store:** add promo video for social media (zh, 9:16) ([819aacf](https://github.com/catnuko/bookmark-sync/commit/819aacf9cd606eced3dd0edfc6606f108c51fdc4))
* **store:** update promo headline to bookmark structure (zh/en) ([e26ff1d](https://github.com/catnuko/bookmark-sync/commit/e26ff1d368fc84335879252906c5cc57e8b5b093))
* **website:** add explain article on Chrome dual bookmark trees with image support ([0962497](https://github.com/catnuko/bookmark-sync/commit/096249708acaa959896975e242ef68e3c25818be))

## [2.12.0](https://github.com/catnuko/bookmark-sync/compare/v2.11.1...v2.12.0) (2026-10-07)


### Features

* **store:** update promo feature tags to 4 items incl AES-256-GCM & free-forever (zh/en) ([aeef48b](https://github.com/catnuko/bookmark-sync/commit/aeef48bb2a106bc6037fc003e22171f6d0f62c11))


### Bug Fixes

* **website:** 修 /admin 进不去（bootstrap 挂起 + 不该 hydrate 预渲染内容） ([47b5cc8](https://github.com/catnuko/bookmark-sync/commit/47b5cc8827692e7e91d8122887aec055baa8d077))

## [2.11.1](https://github.com/catnuko/bookmark-sync/compare/v2.11.0...v2.11.1) (2026-10-07)


### Bug Fixes

* **website:** 关掉 cssCodeSplit，修 SSG 页面全部无样式 ([dada9b2](https://github.com/catnuko/bookmark-sync/commit/dada9b270ec473a5fede3b6fdc0ca8df8003f82b))
* **website:** 关掉 cssCodeSplit，修 SSG 页面全部无样式 ([35cd65f](https://github.com/catnuko/bookmark-sync/commit/35cd65fbf1e932a7bdc7f1546fe70a13bc5d88fd))

## [2.11.0](https://github.com/catnuko/bookmark-sync/compare/v2.10.1...v2.11.0) (2026-10-06)


### Features

* **store:** add premium store screenshots (zh/en) ([ed8db14](https://github.com/catnuko/bookmark-sync/commit/ed8db14cd008e2ff170123d4ca4ac4f9ac08b240))
* **website:** markdown 内容管道 + 10 篇长尾内容（问题解决/迁移/原理） ([1d9b334](https://github.com/catnuko/bookmark-sync/commit/1d9b334dd0a149ea672fbcb2970ce7fe1f67c562))
* **website:** SSG 预渲染 16 页 + 双语独立 URL，SEO 从 CSR 空壳改为可索引 ([b667cca](https://github.com/catnuko/bookmark-sync/commit/b667cca6c79677da804dc18070e0b372ed533bec))


### Bug Fixes

* **store:** remove duplicated bottom content in premium store screenshots (zh/en) ([d795db9](https://github.com/catnuko/bookmark-sync/commit/d795db939a55d517c8fc650290c8d46d79b91e03))
* **website:** hydration 检查改动态导入 playwright，修复 Vercel 构建失败 ([2e5f8c5](https://github.com/catnuko/bookmark-sync/commit/2e5f8c52759e7bca0b4416f3cf8cb438faeec0d4))

## [2.10.1](https://github.com/catnuko/bookmark-sync/compare/v2.10.0...v2.10.1) (2026-10-04)


### Bug Fixes

* **sync:** replica 缺行时禁止盲建，修复重复书签（Fix C） ([8886bc1](https://github.com/catnuko/bookmark-sync/commit/8886bc14c4f01b9c4be2aa9002ee2b6fb901ee29))
* **sync:** 修复删除路径缺失完整性护栏导致的全量书签丢失（P0） ([00e9b4f](https://github.com/catnuko/bookmark-sync/commit/00e9b4f4117bc276ea601c7e7e41d315ff059929))
* **sync:** 捕获回退文件夹内容 + 排除 Firefox 内置默认书签 ([feaa0ec](https://github.com/catnuko/bookmark-sync/commit/feaa0ec1ee599a5ce046f30fe8aac4f0de1d37f6))

## [2.10.0](https://github.com/catnuko/bookmark-sync/compare/v2.9.0...v2.10.0) (2026-10-03)


### Features

* **sync:** 支持 Chrome 双子树（6 固定根）+ 跨设备内容认领 + 无处落地提示 ([e50cda7](https://github.com/catnuko/bookmark-sync/commit/e50cda700452005f0f7a9103e39c6b083222bd23))
* **ui:** 弹窗菜单重构（账户置顶 / 新增系统 / 移除高级）+ 反馈独立菜单 + 口令掩码等易用性修复 ([eb2a28f](https://github.com/catnuko/bookmark-sync/commit/eb2a28f898ee2e56809eabcbde2b282acb1164e5))


### Bug Fixes

* **firefox:** strict_min_version 109→140（Android 142） ([04919b3](https://github.com/catnuko/bookmark-sync/commit/04919b3699fb44111eea9b837bfc950f5f0dceb3))

## [2.9.0](https://github.com/catnuko/bookmark-sync/compare/v2.8.0...v2.9.0) (2026-10-01)


### Features

* **feedback:** 插件内反馈表单 + 后台「反馈/错误上报」双 tab ([371e4a2](https://github.com/catnuko/bookmark-sync/commit/371e4a26cb7c8ceb2332cba72daf56560e62ae65))


### Bug Fixes

* **db:** bsync_op_pull 分页游标取错，&gt;1000 条 op 的空间只拉到第一页 ([6276400](https://github.com/catnuko/bookmark-sync/commit/62764009b48aa2c5f42c3e52acfa3e77d28cf4a4))
* **sync:** 不再捕获/投影浏览器根下的非原生根节点 ([bce4850](https://github.com/catnuko/bookmark-sync/commit/bce485011c7a7ac847054f78be26fb74f954c560))
* **sync:** 根下内部永久文件夹改为「回退落地」，修复同步成功但书签不出现 ([ef630a6](https://github.com/catnuko/bookmark-sync/commit/ef630a6dece4d8db38384e885e2f8d03c5ec826f))

## [2.8.0](https://github.com/catnuko/bookmark-sync/compare/v2.7.0...v2.8.0) (2026-09-30)


### Features

* **popup:** 主屏显示当前账户与扩展版本号，帮助补全自动同步触发时机 ([2c5a35a](https://github.com/catnuko/bookmark-sync/commit/2c5a35af993f4f5236dda6e0faa06e45ee251911))
* **popup:** 增加商店评价入口 ([d0627bb](https://github.com/catnuko/bookmark-sync/commit/d0627bb7b0962c5b11d3554075f4dbc904bf8f79))
* **website:** 并列显示发布版本与商店在架版本，卖点文案升级为跨端跨时收敛 ([362e59b](https://github.com/catnuko/bookmark-sync/commit/362e59b371ef3645b68064d1805701b480ad8d11))


### Bug Fixes

* **i18n:** 补 zh_TW 文案，繁体中文用户不再落英文 ([c109b5f](https://github.com/catnuko/bookmark-sync/commit/c109b5fbc286d7201f90b3d0c1f9c0991798018a))

## [2.7.0](https://github.com/catnuko/bookmark-sync/compare/v2.6.0...v2.7.0) (2026-09-30)


### Features

* **admin:** 后台管理系统移动端适配（抽屉导航 + 卡片表格 + 全屏独立） ([ca317b3](https://github.com/catnuko/bookmark-sync/commit/ca317b303807f4404ec1ae4942b66293d9e79ad3))
* **ci:** 商店提交自动化，独立 publish-stores 工作流 ([aa837db](https://github.com/catnuko/bookmark-sync/commit/aa837dba7b1109bc66941422565e8e559cee6816))


### Bug Fixes

* **crypto:** 云端口令盐区分「问不到」与「没有盐」 ([0d3b11a](https://github.com/catnuko/bookmark-sync/commit/0d3b11aa61832192d1ca1813d42a5453605cdacf))
* **errors:** 抛出物不再只剩 [object Object] ([e1033f7](https://github.com/catnuko/bookmark-sync/commit/e1033f73f9acc7337a64ea50d8ec434d0a2d9dda))
* **popup:** 打开即出界面，失败不再无限转圈 ([0da96fd](https://github.com/catnuko/bookmark-sync/commit/0da96fd847b2a85272fdfe1b014b8f27c54c7ef1))
* **website:** 痛点区补齐第六张卡片，去掉功能区蓝色强调图标 ([cdc7164](https://github.com/catnuko/bookmark-sync/commit/cdc7164bb7075c8c4156e2bceefbea103b34437f))

## [2.6.0](https://github.com/catnuko/bookmark-sync/compare/v2.5.2...v2.6.0) (2026-09-29)


### Features

* **ci:** 发版自动产出 AMO 源码包 ([d538f17](https://github.com/catnuko/bookmark-sync/commit/d538f17d10b13f5270ad31cf3733a5c699f827a1))
* **ci:** 发版自动产出 AMO 源码包 ([e08e9cb](https://github.com/catnuko/bookmark-sync/commit/e08e9cbab72cbd31c3b4512865a511159dd147aa))

## [2.5.2](https://github.com/catnuko/bookmark-sync/compare/v2.5.1...v2.5.2) (2026-09-28)


### Bug Fixes

* **ci:** 发版链路补「按 tag 补发」入口，release-please 加一次重试 ([b5ddb14](https://github.com/catnuko/bookmark-sync/commit/b5ddb14fbcbc85f4684c5410e98ec059c7d566e4))
* **ci:** 发版链路补「按 tag 补发」入口，release-please 加一次重试 ([a8ef34a](https://github.com/catnuko/bookmark-sync/commit/a8ef34ab9b69ca3b36211ddb828ea1219c3fd379))

## [2.5.1](https://github.com/catnuko/bookmark-sync/compare/v2.5.0...v2.5.1) (2026-09-28)


### Bug Fixes

* **creem:** 修复取消即掉档与退款静默丢单两个台账 bug ([6e9310e](https://github.com/catnuko/bookmark-sync/commit/6e9310e2b7d7b5001d1a7e424bc59b48ef768799))
* **creem:** 修复订阅台账静默写不进去的三个问题 ([9632e66](https://github.com/catnuko/bookmark-sync/commit/9632e66a6bb5ca06523dc4939cecde92439d9410))
* **creem:** 取消订阅不再立即降级，改按账期判断（BUG 4） ([b869403](https://github.com/catnuko/bookmark-sync/commit/b86940380422fd9b77b019a18324dd9bd2134b95))
* **creem:** 退款事件不再被静默丢弃（BUG 5） ([60ff401](https://github.com/catnuko/bookmark-sync/commit/60ff4011d0f979ef88910143782e1245b6c38b0b))

## [2.5.0](https://github.com/catnuko/bookmark-sync/compare/v2.4.0...v2.5.0) (2026-09-24)


### Features

* **db:** 错误上报元数据表与上报 RPC（0042） ([6c5d321](https://github.com/catnuko/bookmark-sync/commit/6c5d3210080862417f2ea8ab6b623584db62c8c7))
* **telemetry:** 客户端错误上报（6 处挂点 + MV3 全局钩子 + 开关） ([42e0e96](https://github.com/catnuko/bookmark-sync/commit/42e0e967a76d28981c3db1495627152c999d2e17))


### Bug Fixes

* **build:** 显式关闭生产 sourcemap，防止 .map 随扩展包分发泄露源码 ([f7b5fb4](https://github.com/catnuko/bookmark-sync/commit/f7b5fb4ad785a016fecc9c50a8075e59caab5d8d))
* **db:** 收回 bsync_waitlist 越权读取面（0041） ([041581e](https://github.com/catnuko/bookmark-sync/commit/041581e4298379fd603f3c92f89c558a250577d9))

## [2.4.0](https://github.com/catnuko/bookmark-sync/compare/v2.3.1...v2.4.0) (2026-09-22)


### Features

* **db:** bsync_devices 主键改为 (space_id, id)，支持同一设备登记多个空间 ([4538c61](https://github.com/catnuko/bookmark-sync/commit/4538c6141ca35fcf8f48eacb6709374ad15aa540))
* **db:** 设备表回归「一设备一空间」（迁移 0039） ([b442aa1](https://github.com/catnuko/bookmark-sync/commit/b442aa160bbedf23a1c833dd1ceaaf5928be8e50))
* **spaces:** 多空间并发落地（B2）——切换空间真正生效 ([f5b5d5b](https://github.com/catnuko/bookmark-sync/commit/f5b5d5b8effb7b4ebfed7ef069151225a4c09bf9))


### Bug Fixes

* **errors:** describeError 自身不许退化；oplogClient 不再把 RPC 错误压成 [object Object] ([f1dc9a5](https://github.com/catnuko/bookmark-sync/commit/f1dc9a52bfdfe19abc184d71064b7a0faa50ce93))
* **errors:** reason:'error' 分支统一走 describeError，别让 [object Object] 吞掉诊断 ([3e45612](https://github.com/catnuko/bookmark-sync/commit/3e45612b34c307820197d115fbe5f127c1378225))
* **migration:** octet_length(snap.data) 加 ::text 转换 ([cfd1405](https://github.com/catnuko/bookmark-sync/commit/cfd14053231281b7a697ca835eaf3cac99d473cf))
* **spaces:** 首绑判定按档位细化；修口令门禁假错与 lint 未生效 ([ec56b46](https://github.com/catnuko/bookmark-sync/commit/ec56b467991c27eb3d8b3e9cde1adad28da8707b))
* **sync:** 空父节点下批量创建会整层倒序，第一遍错、第二遍才自愈 ([a7aad11](https://github.com/catnuko/bookmark-sync/commit/a7aad11107f467bd2dae8ecd546b1d17912a79bd))

## [2.3.1](https://github.com/catnuko/bookmark-sync/compare/v2.3.0...v2.3.1) (2026-09-19)


### Bug Fixes

* **ci:** auto-merge 改用 v4 的 prs 输出，修复 release PR 不自动合并 ([0a02e59](https://github.com/catnuko/bookmark-sync/commit/0a02e5912ae67aa1058c29680ad9ee5dc31e392c))
* **ci:** 构建期按 package.json 回填 manifest 版本，修正发版产物版本号 ([c292f78](https://github.com/catnuko/bookmark-sync/commit/c292f78017cacaf7bcee08d9de217e15dd009503))

## [2.3.0](https://github.com/catnuko/bookmark-sync/compare/v2.2.0...v2.3.0) (2026-09-19)


### Features

* **admin:** 0027 收紧 project_members 写入权限（修提权漏洞）+ PROPOSAL 同步至 0027 ([410d2ce](https://github.com/catnuko/bookmark-sync/commit/410d2ceaefe134a905df89fce1a05489e2c30696))
* **admin:** 操作审计查看页 + PROPOSAL 同步至 0026 ([7ba37ed](https://github.com/catnuko/bookmark-sync/commit/7ba37ed1ff02d83b8c88913ece5f1edae56ce74b))
* **ci:** 安装包改由 Supabase Storage 分发，官网运行时寻址最新版 ([71b4729](https://github.com/catnuko/bookmark-sync/commit/71b4729f577f8118cdddea5906764f73bfd9cff7))
* **i18n:** 扩展支持中英双语并收敛口令门禁为单一页面 ([e171a13](https://github.com/catnuko/bookmark-sync/commit/e171a13330a62869694d0d42b0481a121ee3bd89))
* **popup:** 设备支持重命名 ([9873328](https://github.com/catnuko/bookmark-sync/commit/9873328a976452bf6c3a5e908c7611587fbba1ab))
* **supabase:** 单租户化——管理员自有化(0028) + 拆除 license/共享层(0029) ([c4a9778](https://github.com/catnuko/bookmark-sync/commit/c4a9778af52da1bb0465c8e2fa9b5b0125fb286a))
* **supabase:** 收紧字节配额对齐条数承诺，使条数限制可服务端执行 ([46c11b9](https://github.com/catnuko/bookmark-sync/commit/46c11b919f7fa40f7e046029cdf9cd1d535743b0))
* **supabase:** 服务端限流/字节配额/设备上限执行，收回业务表 DML ([76e732a](https://github.com/catnuko/bookmark-sync/commit/76e732a62fc889cfb33237c7542ccc5c2d0d9a76))
* **sync:** 档位化撞顶/设备/限流提示与 Pro 字节预警；官网披露上限 ([6e61ee7](https://github.com/catnuko/bookmark-sync/commit/6e61ee7e04cff0dbd3fb2b763b755b854a1845ab))
* **website:** 新增 /support 支持页（联系邮箱 + FAQ + 资源入口） ([ec1e001](https://github.com/catnuko/bookmark-sync/commit/ec1e00183d8052f6495cb48a8fe9038797163ea1))


### Bug Fixes

* **popup:** 空间重命名撞名时显示「已存在同名空间」友好提示 ([d1a4c4a](https://github.com/catnuko/bookmark-sync/commit/d1a4c4ab0ff6ea8cd6cdd9dffff12a71e5f23e52))
* **sync:** 批量导入加固——持久化发件箱、分块推送、每轮重扫描 ([3eb5dda](https://github.com/catnuko/bookmark-sync/commit/3eb5dda62507e0d8d8709740a12fa19015a4c465))
* **sync:** 登录后先判定口令门禁再渲染主界面，门禁通过自动同步清残留错误 ([80cb351](https://github.com/catnuko/bookmark-sync/commit/80cb351b1c5b7830bef28a7705645b8c49c0ad79))
* **website:** 安装包官网直发，商店卡片改为「即将推出」 ([2b119a9](https://github.com/catnuko/bookmark-sync/commit/2b119a9c685309bfcae8e6aaa571a3aa42435781))

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
