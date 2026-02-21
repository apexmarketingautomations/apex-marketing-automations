import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { CalendarDays, Sun, MessageCircle, Syringe, Bot, Bell, PawPrint, Star, Leaf, MapPin } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "pet-services",
  industry: "Pet Services",
  tagline: "Built for Groomers, Vets & Pet Boarding",
  headline: "Grow Your Pet Business With",
  headlineAccent: "AI-Powered Automation",
  subheadline: "Stop the scheduling chaos. Apex automates booking, vaccination reminders, and client communication — so you can focus on the furry clients who matter most.",
  accentColor: "teal",
  accentGradient: "from-teal-500 to-cyan-600",
  painPoints: [
    { icon: CalendarDays, title: "Scheduling Chaos", desc: "Phone calls during baths, double-bookings, and manual appointment books. Your front desk spends more time scheduling than caring for pets." },
    { icon: Sun, title: "Seasonal Demand Swings", desc: "Holiday boarding rush, summer grooming surge, then dead January. Without consistent marketing, your revenue swings wildly between seasons." },
    { icon: MessageCircle, title: "Client Communication Overload", desc: "Pet parents want constant updates — pick-up times, feeding schedules, post-surgery care. Responding to every text and call eats into your care time." },
    { icon: Syringe, title: "Vaccination & Reminder Gaps", desc: "Tracking vaccination records, rabies renewals, and grooming schedules for hundreds of pets manually means things slip through the cracks." },
  ],
  features: [
    { icon: Bot, title: "AI Scheduling Bot", desc: "24/7 AI assistant that books grooming appointments, boarding stays, vet visits, and daycare. Handles breed-specific time slots, multi-pet families, and special needs requests.", gradient: "from-teal-500 to-cyan-600", stat: "Zero missed bookings" },
    { icon: Bell, title: "Vaccination & Grooming Reminders", desc: "Automated reminders for vaccinations, flea treatments, grooming schedules, and annual checkups. Pet parents get timely texts and book with one tap.", gradient: "from-emerald-500 to-green-600", stat: "92% reminder engagement" },
    { icon: PawPrint, title: "Pet Profile Pages", desc: "Digital profiles for every pet client with breed info, medical history, grooming preferences, dietary needs, and photo galleries. Pet parents love the personal touch.", gradient: "from-amber-500 to-orange-600", stat: "Build deeper client bonds" },
    { icon: Star, title: "Review Generation", desc: "Automatically request Google reviews from happy pet parents after each visit. Smart timing and personalized messages make leaving a review effortless.", gradient: "from-purple-500 to-violet-600", stat: "4.9★ average rating" },
    { icon: Leaf, title: "Seasonal Campaigns", desc: "Pre-built campaigns for holiday boarding, summer grooming packages, dental health month, and seasonal promotions. Automated marketing that fills your slow periods.", gradient: "from-rose-500 to-pink-600", stat: "35% boost in off-peak bookings" },
    { icon: MapPin, title: "Local Ads", desc: "Hyper-local Facebook and Instagram ads targeting pet owners in your service area. AI-generated ad copy featuring your services, reviews, and special offers.", gradient: "from-blue-500 to-indigo-600", stat: "50% lower cost per new client" },
  ],
  stats: [
    { value: 40, suffix: "%", label: "More Repeat Bookings" },
    { value: 92, suffix: "%", label: "Reminder Response Rate" },
    { value: 35, suffix: "%", label: "Off-Peak Revenue Boost" },
    { value: 250, suffix: "+", label: "Pet Businesses Served" },
  ],
  testimonials: [
    { quote: "The AI booking bot handles 80% of our scheduling calls. Pet parents love being able to book grooming at midnight when they realize their dog needs a bath before Thanksgiving.", name: "Sarah Pennington", role: "Owner, Pampered Paws Grooming" },
    { quote: "Vaccination reminders alone brought back 60+ clients who had lapsed. Pet parents genuinely appreciate the texts — they feel like we care about their pets' health, which we do.", name: "Dr. Mark Henson", role: "Veterinarian, Henson Animal Clinic" },
    { quote: "The holiday boarding campaigns fill up our facility weeks in advance now. Last Christmas we had a waitlist for the first time ever. Revenue was up 40% year over year.", name: "Andrea Walsh", role: "Manager, Happy Tails Pet Resort" },
  ],
  faqs: [
    { q: "Can it handle different service types — grooming, boarding, vet, daycare?", a: "Yes. Configure separate booking flows, time slots, and pricing for each service type. The AI handles breed-specific grooming times, boarding check-in/check-out, daycare schedules, and vet appointments." },
    { q: "How do vaccination reminders work?", a: "Enter each pet's vaccination dates and the system automatically sends reminders before they're due. Pet parents receive a text with a one-tap booking link to schedule their visit." },
    { q: "Is pet medical data stored securely?", a: "Absolutely. All pet health records are stored securely with encryption. For veterinary practices, we offer HIPAA-equivalent security standards for animal health data." },
    { q: "Can I send updates to pet parents during boarding?", a: "Yes. Send photo updates, feeding confirmations, and activity reports directly to pet parents via text. You can even set up automated daily updates from templates." },
    { q: "What results do pet service businesses typically see?", a: "Most see a 30-40% increase in repeat bookings within 60 days, significant improvement in review counts, and 25-35% revenue growth during traditionally slow periods." },
  ],
  ctaText: "Start Growing Your Pet Business",
};

export default function PetServicesLanding() {
  return <NicheLanding config={config} />;
}
