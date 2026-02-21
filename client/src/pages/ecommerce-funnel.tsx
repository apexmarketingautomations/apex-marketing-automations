import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { ShoppingBag, Bot, Mail, Target, RefreshCcw, BarChart3 } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "ecommerce",
  industry: "E-Commerce",
  headline: "Get Your Free",
  headlineAccent: "E-Commerce Growth Audit",
  subheadline: "See how AI-powered cart recovery, product recommendations, and retargeting can boost your revenue per visitor and cut customer acquisition costs.",
  accentColor: "amber",
  benefits: [
    { icon: RefreshCcw, text: "AI cart abandonment recovery via SMS and email" },
    { icon: Bot, text: "AI customer support bot trained on your products" },
    { icon: Mail, text: "Post-purchase sequences that drive repeat orders" },
    { icon: Target, text: "Retargeting campaigns across Facebook and Instagram" },
    { icon: ShoppingBag, text: "AI-generated product descriptions and landing pages" },
    { icon: BarChart3, text: "Revenue analytics dashboard with cohort tracking" },
  ],
  qualifyingQuestions: [
    { id: "platform", label: "E-Commerce Platform", type: "select", options: ["Shopify", "WooCommerce", "BigCommerce", "Magento", "Squarespace", "Custom/Headless", "Amazon FBA", "Other"], required: true },
    { id: "monthlyRevenue", label: "Monthly online revenue?", type: "radio", options: ["Under $10K", "$10K-$50K", "$50K-$200K", "$200K+"], required: true },
    { id: "skuCount", label: "How many products (SKUs)?", type: "radio", options: ["Under 25", "25-100", "100-500", "500+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Cart abandonment", "Low repeat purchase rate", "High ad costs", "Slow customer support", "Poor product discovery", "All of the above"] },
  ],
  thankYouTitle: "Your Growth Audit Is Coming!",
  thankYouMessage: "An e-commerce strategist will review your store and prepare a custom AI growth plan with specific recommendations. Check your email for confirmation.",
};

export default function EcommerceFunnel() {
  return <NicheFunnel config={config} />;
}
