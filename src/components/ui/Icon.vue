<template>
  <svg
    viewBox="0 0 24 24"
    :fill="icon.fill ?? 'none'"
    :stroke="icon.stroke ?? 'currentColor'"
    :stroke-width="icon.sw ?? 1.75"
    :stroke-linecap="icon.stroke ? 'round' : undefined"
    :stroke-linejoin="icon.stroke ? 'round' : undefined"
    aria-hidden="true"
  >
    <template v-for="(d, i) in icon.d" :key="i">
      <path :d="d" />
    </template>
    <template v-for="(c, i) in icon.c ?? []" :key="'c' + i">
      <circle v-bind="c" />
    </template>
    <template v-for="(r, i) in icon.r ?? []" :key="'r' + i">
      <rect v-bind="r" />
    </template>
  </svg>
</template>

<script setup>
// 内联 SVG 图标集（Apple HIG 线形，描边统一 1.75，round cap/join）
import { computed } from 'vue';

const props = defineProps({ name: { type: String, required: true } });

const ICONS = {
  // 品牌 logo（实心）
  bookmark: {
    fill: 'currentColor',
    stroke: undefined,
    d: [
      'M6 3h12a1 1 0 0 1 1 1v16.6a.4.4 0 0 1-.62.33L12 16.8l-6.38 4.13A.4.4 0 0 1 5 20.6V4a1 1 0 0 1 1-1Z',
    ],
  },
  check: { d: ['M5 12.5l4 4 10-11'] },
  'check-circle': {
    c: [{ cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: ['M8.4 12.2l2.4 2.4 4.8-5'],
  },
  star: {
    d: ['M12 3.6l2.6 5.28 5.83.85-4.22 4.11 1 5.8L12 16.9l-5.21 2.74 1-5.8L3.57 9.73l5.83-.85z'],
  },
  alert: {
    d: ['M12 4.5l8.6 15H3.4z', 'M12 10v4', 'M12 17h.01'],
  },
  'cloud-slash': {
    d: [
      'M7 17.5a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17 8.2a4.15 4.15 0 0 1 1.6 8.06',
      'M4 4l16 16',
    ],
  },
  info: {
    c: [{ cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: ['M12 11v5', 'M12 8h.01'],
  },
  plus: { d: ['M12 5v14', 'M5 12h14'] },
  refresh: {
    d: ['M20 11a8 8 0 1 0-2.3 6.3', 'M20 5v6h-6'],
  },
  'chevron-right': { d: ['M9 5l7 7-7 7'] },
  'chevron-left': { d: ['M15 5l-7 7 7 7'] },
  copy: {
    r: [
      {
        x: 9,
        y: 9,
        width: 11,
        height: 11,
        rx: 2,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.75,
      },
    ],
    d: ['M5 15V6a2 2 0 0 1 2-2h9'],
  },
  monitor: {
    r: [
      {
        x: 3,
        y: 4,
        width: 18,
        height: 12,
        rx: 2,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.75,
      },
    ],
    d: ['M8 20h8', 'M12 16v4'],
  },
  phone: {
    r: [
      {
        x: 7,
        y: 3,
        width: 10,
        height: 18,
        rx: 2,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.75,
      },
    ],
    d: ['M11 18h2'],
  },
  laptop: {
    r: [
      {
        x: 3,
        y: 4,
        width: 18,
        height: 12,
        rx: 2,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.75,
      },
    ],
    d: ['M8 20h8', 'M12 16v4'],
  },
  lock: {
    r: [
      {
        x: 5,
        y: 11,
        width: 14,
        height: 9,
        rx: 2,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.75,
      },
    ],
    d: ['M8 11V8a4 4 0 0 1 8 0v3'],
  },
  globe: {
    c: [{ cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: ['M3 12h18', 'M12 3c2.5 2.7 2.5 15.3 0 18', 'M12 3c-2.5 2.7-2.5 15.3 0 18'],
  },
  list: { d: ['M8 6h8', 'M8 12h8', 'M8 18h5'] },
  gear: {
    c: [{ cx: 12, cy: 12, r: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3'],
  },
  help: {
    c: [{ cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: ['M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.6-2.5 2-2.5 3.4', 'M12 17h.01'],
  },
  user: {
    c: [{ cx: 12, cy: 8, r: 3.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: ['M5 20a7 7 0 0 1 14 0'],
  },
  trash: {
    d: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13'],
  },
  pencil: {
    d: ['M4 20h4l10-10-4-4L4 16z', 'M13.5 6.5l4 4'],
  },
  folder: {
    d: ['M4 5h16v14H4z', 'M4 9h16'],
  },
  // 整理书签：模型建议的「新文件夹」vs「复用现有文件夹」的区分标
  'folder-plus': {
    d: ['M20 13V5H4v14h9', 'M18 15v6', 'M15 18h6'],
  },
  shield: {
    d: ['M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z', 'M9.3 12l2 2 3.4-3.6'],
  },
  sync: {
    d: ['M20 11a8 8 0 1 0-2.3 6.3', 'M20 5v6h-6'],
  },
  // 对话气泡：书签问答面板的导航图标
  chat: {
    d: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 4V6z'],
  },
  // 纸飞机：发送
  send: {
    d: ['M21.5 2.5L2.5 10.4l7.4 3.1L13 21.5z', 'M9.9 13.5L21.5 2.5'],
  },
  // 实心方块：停止生成（与 send 同一位置切换，实心比描边更醒目）
  stop: {
    r: [{ x: 7, y: 7, width: 10, height: 10, rx: 2, fill: 'currentColor', stroke: 'none' }],
  },
  'log-out': {
    d: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  },
  mail: {
    r: [
      {
        x: 3,
        y: 5,
        width: 18,
        height: 14,
        rx: 2,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.75,
      },
    ],
    d: ['M4 7l8 5.5L20 7'],
  },
  // 「会在新标签页打开网页」的行尾标（与 chevron-right 区分）
  'external-link': {
    d: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14L21 3'],
  },
  // 口令的「显示 / 隐藏」切换（KeyPanel）
  eye: {
    c: [{ cx: 12, cy: 12, r: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: ['M2 12s3.7-6.5 10-6.5S22 12 22 12s-3.7 6.5-10 6.5S2 12 2 12Z'],
  },
  'eye-off': {
    d: ['M2 12s3.7-6.5 10-6.5S22 12 22 12s-3.7 6.5-10 6.5S2 12 2 12Z', 'M4 4l16 16'],
  },
  // 地址栏搜索：设置页导航图标（与 globe 区分，避免两项同图标）
  search: {
    c: [{ cx: 11, cy: 11, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: ['M15.8 15.8l4.7 4.7'],
  },
  // 主题分段：浅色（太阳）
  sun: {
    c: [{ cx: 12, cy: 12, r: 4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75 }],
    d: [
      'M12 2.6v2.2',
      'M12 19.2v2.2',
      'M2.6 12h2.2',
      'M19.2 12h2.2',
      'M5.4 5.4l1.6 1.6',
      'M17 17l1.6 1.6',
      'M18.6 5.4L17 7',
      'M7 17l-1.6 1.6',
    ],
  },
  // 主题分段：深色（月亮）；健康洞察的「沉睡书签」也用它
  moon: {
    d: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z'],
  },
};

const icon = computed(() => ICONS[props.name] ?? ICONS.info);
</script>
