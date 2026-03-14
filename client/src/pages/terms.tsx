export default function Terms() {
  return (
    <div className="min-h-screen bg-[#030014] text-white" data-testid="terms-page">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">Terms of Service</h1>
        <p className="text-sm text-slate-400 mb-8">Last updated: March 14, 2026</p>

        <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Acceptance of Terms</h2>
            <p>By accessing or using Apex Marketing Automations ("Apex," "the platform," "our service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the platform.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Description of Service</h2>
            <p>Apex is a multi-tenant SaaS platform that provides business communication tools, CRM functionality, AI-powered automation, messaging services, website building, and marketing tools. The platform integrates with third-party services including Twilio, Stripe, Google, Meta, and others.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Account Registration</h2>
            <p className="mb-2">To use the platform, you must create an account. You agree to:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Provide accurate and complete registration information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Accept responsibility for all activity under your account</li>
              <li>Notify us immediately of any unauthorized access</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Subscription & Billing</h2>
            <p className="mb-2">Apex offers subscription plans (Starter, Pro, Enterprise) with varying features and usage limits. By subscribing:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>You authorize us to charge your payment method through Stripe</li>
              <li>Subscriptions renew automatically unless cancelled</li>
              <li>Downgrades take effect at the end of the current billing period</li>
              <li>Usage-based charges (SMS, AI credits, voice minutes) are billed according to your plan's rates</li>
              <li>Refunds are handled on a case-by-case basis</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Acceptable Use</h2>
            <p className="mb-2">You agree not to use the platform to:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Send unsolicited messages (spam) or violate telecommunications regulations (TCPA, CAN-SPAM)</li>
              <li>Transmit harmful, threatening, abusive, or illegal content</li>
              <li>Attempt to gain unauthorized access to other accounts or systems</li>
              <li>Interfere with or disrupt the platform's infrastructure</li>
              <li>Violate any applicable laws or regulations</li>
              <li>Misrepresent your identity or affiliation</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Messaging Compliance</h2>
            <p className="mb-2">When using our SMS, WhatsApp, or email messaging features, you are responsible for:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Obtaining proper consent from message recipients</li>
              <li>Honoring opt-out requests promptly (our platform automatically processes STOP keywords)</li>
              <li>Complying with TCPA, CAN-SPAM, GDPR, and other applicable messaging regulations</li>
              <li>Including required disclosures in marketing messages</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Intellectual Property</h2>
            <p>The platform, including its design, features, and content, is owned by Apex Marketing Automations. You retain ownership of the data and content you upload. By using the platform, you grant us a limited license to process your data solely to provide our services.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Third-Party Integrations</h2>
            <p>The platform connects to third-party services (Twilio, Stripe, Google, Meta, etc.). Your use of these integrations is subject to the respective third-party terms and policies. We are not responsible for the availability, accuracy, or conduct of third-party services.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Data & Privacy</h2>
            <p>Your use of the platform is also governed by our <a href="/privacy" className="text-indigo-400 hover:text-indigo-300">Privacy Policy</a>. You are responsible for your own compliance with data protection laws when handling your customers' information through our platform.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Service Availability</h2>
            <p>We strive to maintain high availability but do not guarantee uninterrupted access. We may perform maintenance, updates, or experience outages. We are not liable for any damages resulting from service interruptions.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Apex shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including lost profits, lost data, or business interruption, arising from your use of the platform.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">12. Termination</h2>
            <p>We reserve the right to suspend or terminate your account if you violate these terms. You may cancel your account at any time. Upon termination, your right to use the platform ceases, and we may delete your data after a reasonable retention period.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">13. Changes to Terms</h2>
            <p>We may modify these Terms of Service at any time. Continued use of the platform after changes constitutes acceptance of the updated terms. Material changes will be communicated via email or platform notification.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">14. Governing Law</h2>
            <p>These terms shall be governed by and construed in accordance with the laws of the State of Florida, United States, without regard to conflict of law provisions.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">15. Contact</h2>
            <p>For questions about these Terms of Service, contact us at:</p>
            <p className="mt-2 text-indigo-400">apexmarketingautomations@gmail.com</p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-white/10 text-center">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 text-sm" data-testid="link-back-home">Back to Home</a>
        </div>
      </div>
    </div>
  );
}
