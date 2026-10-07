<script setup>
import HeroSection from '../components/sections/HeroSection.vue';
import PainSection from '../components/sections/PainSection.vue';
import FeatureSection from '../components/sections/FeatureSection.vue';
import BrowserSection from '../components/sections/BrowserSection.vue';
import PricingPreview from '../components/sections/PricingPreview.vue';
import CTASection from '../components/sections/CTASection.vue';
</script>

<template>
  <div class="home">
    <HeroSection />
    <PainSection />
    <FeatureSection />
    <BrowserSection />
    <PricingPreview />
    <!-- ★ 首页不放 FAQ。
         原来这里复用了定价页的 FAQSection（读 pricing.faq，同一份 12 条），
         于是「忘记口令」「换设备恢复」这些问题在首页/定价/文档/支持四处都出现，
         且首页放 12 条价格类 FAQ（退款、支付、为什么订阅）对访客无意义。
         现在按页职责划分：首页只讲价值，FAQ 各归其位（定价=价格、文档=操作、
         支持=账号与安全）。 -->
    <CTASection />
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
}
</style>
