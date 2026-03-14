export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#030014] text-white" data-testid="privacy-page">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">Privacy Policy</h1>
        <p className="text-sm text-slate-400 mb-8">Last updated: March 14, 2026</p>

        <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Introduction</h2>
            <p>Apex Marketing Automations ("Apex," "we," "us," or "our") operates the platform located at apexmarketingautomations.com and related services. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Information We Collect</h2>
            <p className="mb-2"><strong className="text-white">Account Information:</strong> When you create an account, we collect your name, email address, and authentication credentials. If you sign in via Google, Firebase, or Replit, we receive your profile information from those providers.</p>
            <p className="mb-2"><strong className="text-white">Business Data:</strong> Information you provide about your business, including contacts, messages, automations, and campaign content.</p>
            <p className="mb-2"><strong className="text-white">Usage Data:</strong> We automatically collect information about how you interact with the platform, including pages visited, features used, and performance metrics.</p>
            <p><strong className="text-white">Payment Information:</strong> Billing details are processed securely through Stripe. We do not store your full credit card number on our servers.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>To provide, operate, and maintain our platform</li>
              <li>To process transactions and manage your subscription</li>
              <li>To send administrative communications (account updates, security alerts)</li>
              <li>To facilitate messaging and automation features on your behalf</li>
              <li>To improve and personalize your experience</li>
              <li>To detect, prevent, and address technical issues or fraud</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Third-Party Services</h2>
            <p className="mb-2">We integrate with third-party services to provide our platform features. These include:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-white">Twilio:</strong> For SMS and voice communication services</li>
              <li><strong className="text-white">Stripe:</strong> For payment processing</li>
              <li><strong className="text-white">Google:</strong> For authentication, maps, and AI services</li>
              <li><strong className="text-white">Meta:</strong> For social media messaging integrations</li>
              <li><strong className="text-white">Mailchimp:</strong> For email campaign delivery</li>
            </ul>
            <p className="mt-2">Each third-party service has its own privacy policy governing the use of your data.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Data Security</h2>
            <p>We implement industry-standard security measures to protect your information, including encrypted connections (HTTPS/TLS), secure authentication, session management, and access controls. However, no method of electronic transmission or storage is 100% secure.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Data Retention</h2>
            <p>We retain your information for as long as your account is active or as needed to provide our services. You may request deletion of your account and associated data by contacting us.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Your Rights</h2>
            <p className="mb-2">Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Opt out of marketing communications</li>
              <li>Export your data in a portable format</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. SMS/Messaging Consent</h2>
            <p>Messages sent through our platform on your behalf follow applicable telecommunications regulations. Recipients may opt out of SMS communications at any time by replying STOP. We maintain opt-out records and enforce suppression across all messaging channels.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Cookies</h2>
            <p>We use session cookies to maintain your authentication state and provide core platform functionality. We do not use third-party advertising cookies.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Children's Privacy</h2>
            <p>Our platform is not intended for individuals under 18 years of age. We do not knowingly collect personal information from children.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">11. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the updated policy on this page with a revised "Last updated" date.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">12. Contact Us</h2>
            <p>If you have questions about this Privacy Policy, please contact us at:</p>
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
