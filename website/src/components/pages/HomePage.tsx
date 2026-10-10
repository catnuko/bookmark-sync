import { type Locale } from '@/i18n/t';
import HeroSection from '@/components/sections/HeroSection';
import PainSection from '@/components/sections/PainSection';
import FeatureSection from '@/components/sections/FeatureSection';
import BrowserSection from '@/components/sections/BrowserSection';
import PricingPreview from '@/components/sections/PricingPreview';
import CTASection from '@/components/sections/CTASection';
import styles from './HomePage.module.css';

export default function HomePage({ locale }: { locale: Locale }) {
  return (
    <div className={styles.home}>
      <HeroSection locale={locale} />
      <PainSection locale={locale} />
      <FeatureSection locale={locale} />
      <BrowserSection />
      <PricingPreview locale={locale} />
      {/* ★ 首页不放 FAQ。
           原来这里复用了定价页的 FAQSection（读 pricing.faq，同一份 12 条），
           于是「忘记口令」「换设备恢复」这些问题在首页/定价/文档/支持四处都出现，
           且首页放 12 条价格类 FAQ（退款、支付、为什么订阅）对访客无意义。
           现在按页职责划分：首页只讲价值，FAQ 各归其位（定价=价格、文档=操作、
           支持=账号与安全）。 */}
      <CTASection locale={locale} />
    </div>
  );
}
