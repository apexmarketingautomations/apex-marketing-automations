import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { CalendarX, Star, Megaphone, ClipboardList, Bot, MessageSquare, UtensilsCrossed, Globe, Navigation, Camera } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "restaurants",
  industry: "Restaurants",
  tagline: "Built for Restaurants & Food Service",
  headline: "Fill More Tables With",
  headlineAccent: "AI-Powered Marketing",
  subheadline: "Stop losing revenue to no-shows and bad reviews. Apex automates reservations, manages your reputation, and keeps your dining room full — on autopilot.",
  accentColor: "orange",
  accentGradient: "from-orange-500 to-amber-600",
  painPoints: [
    { icon: CalendarX, title: "No-Shows & Empty Tables", desc: "Up to 20% of reservations are no-shows. Each empty table costs you $50-200 in lost revenue — and you have no system to fill last-minute cancellations." },
    { icon: Star, title: "Bad Reviews Go Unanswered", desc: "One negative Yelp or Google review can cost you 30 potential customers. Without a reputation system, bad reviews pile up while happy diners stay silent." },
    { icon: Megaphone, title: "Inconsistent Marketing", desc: "You post on Instagram when you remember, run a special when it's slow, and hope word of mouth does the rest. There's no consistent marketing engine." },
    { icon: ClipboardList, title: "Manual Reservation Chaos", desc: "Phone calls during rush, scribbled reservation books, double-bookings, and no way to capture diner information for future marketing." },
  ],
  features: [
    { icon: Bot, title: "AI Reservation Bot", desc: "24/7 AI assistant that takes reservations via phone, text, and web chat. Handles party size, dietary needs, special occasions — and sends automatic confirmations.", gradient: "from-orange-500 to-red-600", stat: "Zero missed reservations" },
    { icon: Star, title: "Review Management", desc: "Automatically request reviews from happy diners after their visit. Route 5-star experiences to Google and Yelp. Catch negative feedback before it goes public.", gradient: "from-amber-500 to-yellow-600", stat: "3x more 5-star reviews" },
    { icon: MessageSquare, title: "SMS Campaigns", desc: "Send targeted SMS blasts for daily specials, happy hour promos, and slow-night offers. Reach your entire diner database with one click.", gradient: "from-emerald-500 to-teal-600", stat: "45% open rate average" },
    { icon: UtensilsCrossed, title: "Menu Landing Pages", desc: "Beautiful, mobile-first landing pages for your menu, seasonal specials, catering packages, and events — with online ordering and reservation widgets built in.", gradient: "from-rose-500 to-pink-600", stat: "Launch pages in 60 seconds" },
    { icon: Navigation, title: "Google Review Routing", desc: "Smart routing system sends satisfied customers directly to your Google Business listing. Negative experiences are captured privately so you can resolve them first.", gradient: "from-blue-500 to-indigo-600", stat: "4.7★ average restaurant rating" },
    { icon: Camera, title: "Social Media Ads", desc: "Launch Instagram and Facebook ads featuring your best dishes with AI-generated copy. Target foodies in your area and drive reservations directly.", gradient: "from-purple-500 to-violet-600", stat: "52% lower cost per reservation" },
  ],
  stats: [
    { value: 35, suffix: "%", label: "Fewer No-Shows" },
    { value: 4, suffix: "x", label: "More Google Reviews" },
    { value: 22, suffix: "%", label: "Revenue Increase" },
    { value: 800, suffix: "+", label: "Restaurants Served" },
  ],
  testimonials: [
    { quote: "No-shows dropped from 18% to under 5% after implementing the AI confirmation system. The automated reminders and waitlist filling are game changers for our bottom line.", name: "Carlos Rivera", role: "Owner, Rivera's Bistro" },
    { quote: "We went from 47 Google reviews to over 300 in four months. The smart review routing only asks happy guests to post publicly. Our rating went from 4.1 to 4.8 stars.", name: "Lisa Chen", role: "GM, Golden Dragon Restaurant Group" },
    { quote: "The SMS campaigns for our Tuesday slow nights fill tables every single week now. We send a special offer at 2pm and we're fully booked by 5pm. It's incredible.", name: "James Whitfield", role: "Owner, The Rustic Table" },
  ],
  faqs: [
    { q: "Does this work with my existing POS system?", a: "Yes. Apex integrates with Toast, Square, Clover, and most major POS systems. Reservation data and customer info sync seamlessly." },
    { q: "Can I send SMS campaigns without annoying my customers?", a: "Absolutely. Our system includes opt-in management, frequency caps, and smart timing. Customers only receive messages they've opted into, and you can set maximum sends per week." },
    { q: "How does the AI handle complex reservations?", a: "The AI can manage party size, dietary restrictions, special occasions, high-top vs booth preferences, and even private dining requests. For truly complex needs, it seamlessly transfers to your host team." },
    { q: "Will this help with catering and private events?", a: "Yes. You can create dedicated landing pages for catering menus and event packages, with AI-powered inquiry forms that qualify leads and provide instant quotes." },
    { q: "How quickly can I see results?", a: "Most restaurants see a measurable increase in reviews within the first two weeks and a reduction in no-shows immediately. Full marketing automation results typically show within 30-60 days." },
  ],
  ctaText: "Fill More Tables Tonight",
};

export default function RestaurantsLanding() {
  return <NicheLanding config={config} />;
}
