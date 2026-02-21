import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { CalendarX, UserX, HelpCircle, Bell, Phone, Mail, Globe, Star, Bot, RefreshCw } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "dentists",
  industry: "Dental Practices",
  tagline: "Built for Modern Dental Practices",
  headline: "Keep Your Chairs Full With",
  headlineAccent: "AI-Powered Patient Growth",
  subheadline: "Stop losing patients to missed appointments and poor follow-up. Apex automates booking, recall, and reviews — so your schedule stays packed and your practice grows.",
  accentColor: "sky",
  accentGradient: "from-sky-500 to-blue-600",
  painPoints: [
    { icon: CalendarX, title: "Missed Appointments", desc: "Empty chair time costs dental practices $200-500 per hour. Without automated reminders, 15-20% of appointments are missed or cancelled last-minute." },
    { icon: UserX, title: "Patient No-Shows", desc: "Patients book and forget. Your front desk spends hours calling to confirm, leaving less time for in-office patient care and new patient onboarding." },
    { icon: HelpCircle, title: "Insurance Questions Overload", desc: "Your team spends 30+ minutes per day answering the same insurance and coverage questions. It's the #1 reason patients hesitate to book." },
    { icon: Bell, title: "Manual Reminder Calls", desc: "Your front desk is buried in confirmation calls, recall lists, and follow-up reminders. It's inefficient and patients still slip through the cracks." },
  ],
  features: [
    { icon: Phone, title: "AI Appointment Booking", desc: "24/7 AI receptionist that books cleanings, consultations, and emergency visits. Handles insurance verification questions and finds available slots automatically.", gradient: "from-sky-500 to-blue-600", stat: "Zero missed patient calls" },
    { icon: Mail, title: "Patient Recall Campaigns", desc: "Automated recall sequences for 6-month cleanings, annual exams, and incomplete treatment plans. Patients get personalized reminders via text, email, and voice.", gradient: "from-cyan-500 to-teal-600", stat: "68% recall rate achieved" },
    { icon: Globe, title: "Treatment Page Builder", desc: "Create stunning landing pages for implants, Invisalign, veneers, and whitening with before/after galleries, pricing info, and instant booking widgets.", gradient: "from-emerald-500 to-green-600", stat: "Launch pages in 60 seconds" },
    { icon: Star, title: "Review Management", desc: "Automatically request Google reviews after positive visits. Smart routing ensures only happy patients are asked to review publicly. Protect your online reputation.", gradient: "from-amber-500 to-orange-600", stat: "4.9★ average practice rating" },
    { icon: Bot, title: "Insurance FAQ Bot", desc: "AI chatbot trained on your accepted insurance plans, payment options, and financing. Answers patient questions 24/7 and removes the #1 booking barrier.", gradient: "from-purple-500 to-violet-600", stat: "82% of questions auto-answered" },
    { icon: RefreshCw, title: "Recall Automation", desc: "Never let a patient fall off your recall list again. Automated workflows re-engage inactive patients with personalized offers and easy one-tap rebooking.", gradient: "from-pink-500 to-rose-600", stat: "35% reactivation rate" },
  ],
  stats: [
    { value: 92, suffix: "%", label: "Appointment Show Rate" },
    { value: 68, suffix: "%", label: "Patient Recall Rate" },
    { value: 34, suffix: "%", label: "New Patient Increase" },
    { value: 400, suffix: "+", label: "Dental Practices Served" },
  ],
  testimonials: [
    { quote: "Our no-show rate dropped from 22% to under 6% within the first month. The automated text reminders with one-tap confirm and reschedule options are what patients actually respond to.", name: "Dr. Rachel Simmons", role: "Owner, Bright Smile Dental" },
    { quote: "The recall automation brought back 140 inactive patients in our first quarter. These are patients we thought were gone forever — now they're booking cleanings again.", name: "Dr. Kevin Park", role: "Partner, Park Family Dentistry" },
    { quote: "Our front desk used to spend 3 hours a day on confirmation calls. Now the AI handles everything and our team focuses on in-office patient experience. Total game changer.", name: "Michelle Torres", role: "Practice Manager, Coastal Dental Group" },
  ],
  faqs: [
    { q: "Is this HIPAA compliant?", a: "Yes. All patient data is encrypted at rest and in transit. Our systems are fully HIPAA compliant with BAA agreements available. Patient communications are secure and private." },
    { q: "Does it integrate with my practice management software?", a: "Apex integrates with Dentrix, Eaglesoft, Open Dental, and other major PMS platforms. Appointment data syncs both ways so your schedule stays accurate." },
    { q: "Can patients book specific procedures online?", a: "Absolutely. The AI booking system can handle cleanings, consultations, emergency visits, cosmetic procedures, and more. It checks availability and matches appointment length to procedure type." },
    { q: "How does the insurance FAQ bot work?", a: "You upload your accepted insurance plans and coverage details. The AI answers patient questions about coverage, copays, and financing options 24/7 — removing the biggest barrier to booking." },
    { q: "What results can I expect?", a: "Most practices see a 25-35% reduction in no-shows within the first month and a 15-25% increase in new patient bookings within 90 days. Recall campaigns typically reactivate 30-40% of lapsed patients." },
  ],
  ctaText: "Start Filling Your Schedule",
};

export default function DentistsLanding() {
  return <NicheLanding config={config} />;
}
