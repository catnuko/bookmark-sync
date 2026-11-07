import { type Locale } from '@/i18n/t';
import HeroSection from '@/components/sections/HeroSection';
import OpenSourceSection from '@/components/sections/OpenSourceSection';
import PainSection from '@/components/sections/PainSection';
import BrowserSection from '@/components/sections/BrowserSection';
import CompareSection from '@/components/sections/CompareSection';
import PricingPreview from '@/components/sections/PricingPreview';
import CTASection from '@/components/sections/CTASection';
import styles from './HomePage.module.css';

export default function HomePage({ locale }: { locale: Locale }) {
  return (
    <div className={styles.home}>
      <HeroSection locale={locale} />
      {/* ★ 2026-11-07 新增：仓库转 public 后，hero 正下方放「永久开源」说明（catnuko 要求显眼处）。 */}
      <OpenSourceSection locale={locale} />
      <PainSection locale={locale} />
      {/* ★ 2026-10 删除「为真实同步场景打磨的引擎」整块（原 FeatureSection，9 张功能卡）。
           理由：它讲的是「我们有什么能力」，而访客真正想知道的是「和你已经在用的那个
           差在哪」——后者一张对比矩阵就说清了，前者的信息量被稀释在 9 个卡片的标题里。
           卡片里的细节（真树/墓碑删除/多空间等）仍然在对比矩阵的维度行与
           /explain/bookmark-sync-vs-alternatives 里，没有丢。 */}
      <BrowserSection />
      {/* 对比放在「支持哪些浏览器」之后、「定价」之前：
          访客此时已知道自己要解决什么、我们支持什么，接下来最想知道的是
          「和我已经在用的那个有什么不一样」——回答完再谈钱，顺序才顺。
          表格只放结论，完整理由链到 /explain/bookmark-sync-vs-alternatives。 */}
      <CompareSection locale={locale} />
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
