import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { ShoppingCart, UserMinus, DollarSign, PackageX, RotateCcw, Bot, Globe, Heart, Star, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "ecommerce",
  industry: "E-Commerce",
  tagline: "Built for Online Stores & Retail Brands",
  headline: "Recover Lost Revenue With",
  headlineAccent: "AI-Powered Retention",
  subheadline: "70% of carts are abandoned. Apex recovers them automatically, turns one-time buyers into loyal customers, and slashes your ad costs with smart retention.",
  accentColor: "amber",
  accentGradient: "from-amber-500 to-orange-600",
  painPoints: [
    { icon: ShoppingCart, title: "Cart Abandonment Epidemic", desc: "70% of online shoppers abandon their cart. That's thousands in lost revenue every month sitting in checkout pages that never convert." },
    { icon: UserMinus, title: "One-and-Done Customers", desc: "Acquiring a new customer costs 5-7x more than retaining one. But without post-purchase automation, most buyers never come back for a second order." },
    { icon: DollarSign, title: "Skyrocketing Ad Costs", desc: "Facebook and Google CPMs keep rising. You're spending more to acquire each customer while your ROAS keeps declining quarter over quarter." },
    { icon: PackageX, title: "Returns & Negative Reviews", desc: "High return rates and negative reviews tank your margins and reputation. Without proactive customer support, small issues become expensive problems." },
  ],
  features: [
    { icon: RotateCcw, title: "Abandoned Cart Recovery", desc: "Multi-channel cart recovery via email, SMS, and push notifications. Personalized messaging with dynamic product images and smart discount offers recover lost sales.", gradient: "from-amber-500 to-orange-600", stat: "18% cart recovery rate" },
    { icon: Bot, title: "AI Customer Support", desc: "24/7 AI chatbot that handles order status, returns, sizing questions, and product recommendations. Resolve 80% of tickets automatically without human agents.", gradient: "from-blue-500 to-indigo-600", stat: "80% auto-resolution rate" },
    { icon: Globe, title: "Product Landing Pages", desc: "High-converting landing pages for product launches, seasonal collections, and flash sales. AI-generated copy, reviews, and urgency elements drive conversions.", gradient: "from-emerald-500 to-teal-600", stat: "2.4x higher conversion" },
    { icon: Heart, title: "Loyalty Campaigns", desc: "Automated loyalty programs with points, tiers, and rewards. Post-purchase sequences, birthday offers, and VIP perks turn one-time buyers into brand advocates.", gradient: "from-rose-500 to-pink-600", stat: "55% repeat purchase rate" },
    { icon: Star, title: "Review Collection", desc: "Automated post-purchase review requests with photo upload prompts. Smart timing sends requests when customer satisfaction peaks. Build social proof at scale.", gradient: "from-purple-500 to-violet-600", stat: "5x more product reviews" },
    { icon: Target, title: "Retargeting Ads", desc: "Dynamic retargeting ads that show customers the exact products they viewed. AI optimizes bids, creative, and audiences to maximize ROAS across Meta and Google.", gradient: "from-cyan-500 to-blue-600", stat: "340% average ROAS" },
  ],
  stats: [
    { value: 18, suffix: "%", label: "Cart Recovery Rate" },
    { value: 55, suffix: "%", label: "Repeat Purchase Rate" },
    { value: 340, suffix: "%", label: "Average Ad ROAS" },
    { value: 700, suffix: "+", label: "Stores Trust Apex" },
  ],
  testimonials: [
    { quote: "Cart recovery alone adds $12K in monthly revenue we were leaving on the table. The multi-channel approach — email then SMS then push — catches people at the right moment.", name: "Kelsey Wong", role: "Founder, Bloom & Vine Skincare" },
    { quote: "Our customer support ticket volume dropped 75% after deploying the AI chatbot. It handles order tracking, returns, and sizing questions better than most human agents.", name: "Jason Liu", role: "COO, Urban Athletics Co." },
    { quote: "The loyalty program increased our repeat purchase rate from 18% to 52%. Customers love earning points and we love the predictable revenue. It's a perfect flywheel.", name: "Rachel Stern", role: "Head of Growth, Luxe Home Goods" },
  ],
  faqs: [
    { q: "Does it integrate with Shopify, WooCommerce, etc?", a: "Yes. Apex integrates seamlessly with Shopify, WooCommerce, BigCommerce, and other major e-commerce platforms. Product data, order information, and customer profiles sync automatically." },
    { q: "How does the abandoned cart recovery work?", a: "When a customer abandons their cart, they receive a timed sequence of recovery messages — email first, then SMS, then push notification — each with personalized product images and smart discount offers." },
    { q: "Can the AI chatbot handle complex support issues?", a: "The AI handles 80% of common inquiries automatically. For complex issues, it seamlessly escalates to your human support team with full conversation context and customer history." },
    { q: "How is this different from Klaviyo or Omnisend?", a: "Apex combines email, SMS, chatbot, landing pages, ads, and loyalty into one platform. Instead of paying for 4-5 separate tools, you get everything connected and working together from day one." },
    { q: "What ROI can I expect?", a: "Most stores see positive ROI within the first month from cart recovery alone. Full platform ROI — including loyalty, reviews, and ad optimization — typically delivers 5-10x return within 90 days." },
  ],
  ctaText: "Start Recovering Revenue",
};

export default function EcommerceLanding() {
  return <NicheLanding config={config} />;
}
