<script setup>
// LocalizedLink —— 自动补语言前缀的站内链接。
//
// 为什么需要：/en/pricing 页面上如果出现 <RouterLink to="/pricing">，
// 爬虫顺着爬到的就是中文页 → hreflang cluster 在抓取层面断裂（英文页的
// 内链权重流向中文 URL），英文页也拿不到中文页的内部链接支撑。
//
// 规则：按**当前 URL 的语言**加前缀（不是按 i18n 记忆）——
// 与 canonical / SEO 文案同源，避免出现「英文页里链到中文页」的不一致。
//
// admin 链接不要用这个组件（后台不带语言前缀），那里继续用 RouterLink。
import { computed, useAttrs } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { localeFromPath, pathForLocale } from '../router/routes';

const props = defineProps({
  to: { type: [String, Object], required: true },
});

const route = useRoute();

const target = computed(() => {
  if (typeof props.to === 'string') {
    // 只处理站内绝对路径；外链 / 带 query / mailto 原样透传
    if (!props.to.startsWith('/')) return props.to;
    if (props.to.startsWith('/en/') || props.to === '/en') return props.to;
    return pathForLocale(props.to, localeFromPath(route.path));
  }
  return props.to;
});
</script>

<template>
  <RouterLink :to="target" v-bind="$attrs"><slot /></RouterLink>
</template>
