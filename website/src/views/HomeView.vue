<script setup>
import HeroSection from '../components/sections/HeroSection.vue';
import PainSection from '../components/sections/PainSection.vue';
import FeatureSection from '../components/sections/FeatureSection.vue';
import BrowserSection from '../components/sections/BrowserSection.vue';
import PricingPreview from '../components/sections/PricingPreview.vue';
import FAQSection from '../components/sections/FAQSection.vue';
import CTASection from '../components/sections/CTASection.vue';
</script>

<template>
  <div class="home">
    <HeroSection />
    <PainSection />
    <FeatureSection />
    <BrowserSection />
    <PricingPreview />
    <FAQSection />
    <CTASection />
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
}
</style>
