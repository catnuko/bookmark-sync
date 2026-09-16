<template>
  <section class="pane active">
    <h2>帮助</h2>
    <p class="pane-sub">常见问题与关键行为说明。点击条目展开。</p>

    <div class="grp">
      <div class="acc">
        <div v-for="(item, i) in items" :key="i" class="acc-item" :class="{ open: openIdx === i }">
          <button type="button" class="acc-head" @click="openIdx = openIdx === i ? -1 : i">
            <span class="acc-t">{{ item.title }}</span>
            <Icon class="chev" name="chevron-right" />
          </button>
          <div class="acc-body">
            <div class="acc-inner" v-html="item.body"></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref } from "vue";
import Icon from "./ui/Icon.vue";

const openIdx = ref(-1);

const items = [
  {
    title: "🦊 Firefox 的「书签菜单」",
    body: `<p>Firefox 自带一个<strong>「书签菜单」</strong>位置（地址栏星标添加书签时默认存到这里），Chrome 里没有对应位置，所以扩展会在 Chrome 的书签栏下自动创建一个同名文件夹来承接。</p><p>在 Chrome 里<strong>删除这个「书签菜单」文件夹，只会清空菜单里的书签（会同步到所有设备），文件夹本身会自动恢复</strong>——这是设计行为，不是故障。请不要反复删除它；想清空菜单内容时，直接删除里面的书签即可。</p>`,
  },
  {
    title: "🔑 同步口令（端到端加密）",
    body: `<p>所有书签操作都在本机加密后上传（AES-256-GCM），服务器只保存密文。首次使用时设置一个<strong>同步口令</strong>；换设备 / 重装后，在新设备登录并输入<strong>同一口令</strong>即可同步书签。口令本身不上传服务器，只在本机派生出解密密钥。<strong>忘记口令 = 数据无法找回</strong>，请把口令另存到密码管理器。</p>`,
  },
  {
    title: "🗑️ 删除行为",
    body: `<p>删除书签 / 文件夹会生成「墓碑」并同步到所有设备，删除是跨设备一致的；删除的文件不会被云端重新拉回。删除「书签菜单」文件夹例外：只清空内容、位置保留。</p>`,
  },
  {
    title: "🔄 换设备 / 重装",
    body: `<p>1. 在旧设备上牢记同步口令；<br />2. 新设备安装后登录同一账号；<br />3. 按引导输入<strong>同一口令</strong>；<br />4. 点「立即同步」，书签自动从云端恢复。新设备会自动创建默认同步空间，无需手动建空间。</p>`,
  },
  {
    title: "🧩 版本更新提示",
    body: `<p>通过开发者模式加载的扩展不会自动更新：改动代码后需重新构建（<strong>npm run build</strong>）并到浏览器扩展管理页「重新加载」。</p>`,
  },
  {
    title: "🗂️ 同步空间与设备",
    body: `<p>每个空间是一棵独立书签树（如工作 / 个人），可绑定不同浏览器资料；Free 档 1 个空间，Plus 3 个，Pro / Lifetime 10 个。同步中的浏览器会自动登记，可在此查看、改名或解除。</p>`,
  },
  {
    title: "📡 同步完成提示怎么看？",
    body: `<p>同步后的提示按结果方向描述，不再显示「推送 / 拉取几条」——那个数字是内部同步操作数，和你实际的书签数对不上，容易误导。对照如下：</p>
<table class="help-tbl">
<thead><tr><th>你看到的提示</th><th>含义</th></tr></thead>
<tbody>
<tr><td>首次同步完成，书签已加密上传</td><td>本机第一次把本地书签整体上传到云端（云端原本是空的）</td></tr>
<tr><td>首次同步完成，已从云端恢复书签</td><td>新设备 / 重装后，把云端已有书签拉到本机</td></tr>
<tr><td>双向同步完成</td><td>本机和其他设备都有改动，已互相同步</td></tr>
<tr><td>已上传本地变更</td><td>只把本机新增 / 修改的书签传到了云端</td></tr>
<tr><td>已同步其他设备的变更</td><td>收到了别的设备新加的书签</td></tr>
<tr><td>已是最新</td><td>没有新变更，无需操作</td></tr>
</tbody>
</table>
<p>状态卡上的「N 条书签」是真实书签总数，是准确的。看到「⚠️ N 条云端数据解密失败」说明同步密钥和云端数据不匹配，请检查密钥或口令。</p>`,
  },
];
</script>

<style>
.acc-inner table.help-tbl { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: var(--fs-secondary); }
.acc-inner table.help-tbl th,
.acc-inner table.help-tbl td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border-strong, rgba(128,128,128,.2)); vertical-align: top; }
.acc-inner table.help-tbl th { color: var(--text-primary); font-weight: var(--fw-semibold, 600); }
.acc-inner table.help-tbl td:first-child { white-space: nowrap; color: var(--text-primary); }
</style>
