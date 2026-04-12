# Meta App Review Submission Package
## Apex Marketing Automations — App ID: 1241083361501051

**Prepared:** April 12, 2026
**Business:** Apex Marketing Automations
**Domain:** apexmarketingautomations.com
**Category:** Business Services / Marketing SaaS Platform

---

## 1. App Description (for Meta App Review)

Apex Marketing Automations is a multi-tenant SaaS platform that helps small businesses manage their marketing, customer communication, and advertising from a single dashboard. Our platform serves businesses across 17+ industries including home services, dental, legal, real estate, restaurants, and more.

The platform connects to a business's Facebook Page and Instagram Business Account to provide:
- **Unified Inbox** — Read and reply to Facebook Messenger and Instagram DMs from one dashboard
- **AI Comment Bot** — Automatically reply to comments on Facebook and Instagram posts with intelligent, context-aware responses
- **Content Planner** — Schedule and publish posts to Facebook Pages and Instagram feeds
- **Ad Launcher** — Create and manage Meta advertising campaigns with geofence targeting
- **Lead Sync** — Automatically import leads from Meta Lead Gen Forms into the built-in CRM

Each customer (sub-account) connects their own Facebook Page and Instagram account using OAuth. The platform never shares credentials between accounts.

---

## 2. Permissions Required

### PERMISSION: pages_messaging
**Use Case:** Unified messaging inbox for Facebook Messenger

**How it's used:**
- Read incoming Messenger conversations from the customer's Facebook Page
- Send replies to customers who message the Page
- Display conversation history in the unified inbox dashboard

**User flow:**
1. Business owner logs into Apex Marketing Automations
2. Navigates to "Meta Messaging" in the sidebar
3. Sees all Messenger conversations from their Facebook Page
4. Clicks a conversation to read the thread
5. Types and sends a reply, which is delivered via Messenger

**API calls:**
- `GET /{page-id}/conversations` — fetch message threads
- `POST /{page-id}/messages` — send reply to a thread

**Why needed:** Small businesses miss messages when they can't monitor Messenger all day. This lets them manage all messages from one place alongside SMS, email, and Instagram DMs.

---

### PERMISSION: instagram_manage_messages
**Use Case:** Unified messaging inbox for Instagram DMs

**How it's used:**
- Read incoming Instagram Direct Messages via the connected Page
- Send replies to Instagram DMs
- Sync conversation history into the unified inbox

**User flow:**
1. Business owner navigates to "Meta Messaging" or "Instagram Inbox"
2. Sees Instagram DM threads alongside Facebook messages
3. Reads and replies to Instagram DMs from the dashboard
4. Conversation history is stored for CRM context

**API calls:**
- `GET /{page-id}/conversations?platform=instagram` — fetch IG DM threads
- `POST /{page-id}/messages` — send IG DM reply

**Why needed:** Businesses with Instagram presence need to respond to DMs promptly. This unifies Instagram and Facebook messaging into one inbox so nothing gets missed.

---

### PERMISSION: pages_manage_metadata
**Use Case:** Webhook subscriptions for real-time messaging and comment notifications

**How it's used:**
- Subscribe the customer's Facebook Page to receive webhook events
- Required for real-time delivery of new messages and comments
- Manage Page webhook subscriptions programmatically

**User flow:**
1. When a business connects their Facebook Page, the platform subscribes to webhook events
2. New messages, comments, and lead form submissions trigger webhooks
3. The platform processes these events in real time

**API calls:**
- `GET /{page-id}/subscribed_apps` — check current webhook subscriptions
- `POST /{page-id}/subscribed_apps` — subscribe to webhook events

**Why needed:** Without webhook subscriptions, the platform would need to constantly poll for new messages, causing delays and excessive API calls.

---

### PERMISSION: pages_read_engagement
**Use Case:** Read Page content for comment context and analytics

**How it's used:**
- Fetch post content (captions, text) to provide context for AI comment replies
- Read engagement metrics for analytics dashboards
- Detect the Instagram Business Account linked to a Facebook Page

**User flow:**
1. Comment arrives on a customer's post (via webhook)
2. Platform fetches the post caption to understand context
3. AI generates a relevant reply based on the post content
4. Reply is posted (using pages_manage_metadata or instagram_manage_comments)

**API calls:**
- `GET /{post-id}?fields=caption,message` — fetch post context
- `GET /{page-id}?fields=instagram_business_account` — resolve linked IG account
- `GET /{page-id}/leadgen_forms` — list available lead forms

**Why needed:** AI-powered comment replies need to understand what the original post is about. Blindly replying without context would produce irrelevant responses.

---

### PERMISSION: instagram_basic
**Use Case:** Access basic Instagram Business Account information

**How it's used:**
- Resolve the Instagram Business Account ID linked to a Facebook Page
- Fetch Instagram account username and profile for display
- List Instagram media (posts) for comment management

**User flow:**
1. Business connects their Facebook Page
2. Platform detects the linked Instagram Business Account
3. Displays the Instagram account info in the integrations dashboard
4. Enables Instagram features (DMs, comments, publishing)

**API calls:**
- `GET /{page-id}?fields=instagram_business_account{id,username,name}` — resolve IG account
- `GET /{ig-user-id}/media` — list Instagram posts

**Why needed:** Essential for linking a Facebook Page to its Instagram account and enabling Instagram-specific features.

---

### PERMISSION: instagram_manage_comments
**Use Case:** AI-powered Instagram comment automation

**How it's used:**
- Automatically reply to comments on Instagram posts
- AI reads the post caption and comment text, then generates a contextual reply
- Replies are posted as the business's Instagram account

**User flow:**
1. Someone comments on the business's Instagram post
2. Webhook delivers the comment event
3. AI analyzes the comment + post caption
4. Generates and posts a relevant reply
5. Business owner can see all auto-replies in the dashboard and adjust settings

**API calls:**
- `POST /{comment-id}/comments` — reply to an Instagram comment
- `GET /{media-id}?fields=caption` — fetch post context for AI

**Why needed:** Small businesses can't monitor every comment 24/7. Automated, intelligent replies keep customers engaged and boost engagement metrics.

---

### PERMISSION: pages_manage_posts
**Use Case:** Content planner — schedule and publish Facebook posts

**How it's used:**
- Publish text and image posts to the customer's Facebook Page
- Schedule posts for future publishing via the content calendar
- Support the content planner feature

**User flow:**
1. Business owner opens "Content Planner" in the dashboard
2. Creates a post with text and optional image
3. Selects a date/time to publish or publishes immediately
4. Platform publishes the post to their Facebook Page feed

**API calls:**
- `POST /{page-id}/feed` — publish a post to the Page

**Why needed:** The content planner lets businesses plan and schedule their social media content weeks in advance, saving time and maintaining consistency.

---

### PERMISSION: instagram_content_publish
**Use Case:** Content planner — schedule and publish Instagram posts

**How it's used:**
- Publish image posts to the customer's Instagram Business Account
- Uses the two-step container/publish flow required by Instagram API
- Integrated with the content calendar for scheduled publishing

**User flow:**
1. Business owner creates a post in the Content Planner
2. Selects Instagram as the target platform
3. Uploads an image and writes a caption
4. Platform creates a media container, then publishes it

**API calls:**
- `POST /{ig-user-id}/media` — create media container
- `POST /{ig-user-id}/media_publish` — publish the container

**Why needed:** Businesses need to maintain a consistent Instagram presence. The content planner automates scheduling across both Facebook and Instagram.

---

### PERMISSION: ads_management
**Use Case:** Create and manage Meta advertising campaigns

**How it's used:**
- Create new ad campaigns in the customer's Meta Ad Account
- Set targeting parameters (location, demographics, interests)
- Manage campaign budgets and scheduling

**User flow:**
1. Business owner opens "Ad Launcher" in the dashboard
2. Selects campaign objective, audience targeting, and budget
3. Uploads creative (image/video) and writes ad copy
4. Platform creates the campaign in their Meta Ad Account

**API calls:**
- `POST /act_{ad-account-id}/campaigns` — create a campaign

**Why needed:** Small businesses lack the expertise to navigate Meta Ads Manager directly. The Ad Launcher simplifies campaign creation with guided workflows and AI-assisted copy.

---

### PERMISSION: ads_read
**Use Case:** Sync advertising performance metrics

**How it's used:**
- Fetch campaign performance data (impressions, clicks, spend, CPC, CTR)
- Display ROI metrics in the analytics dashboard
- Background sync every 45 minutes for up-to-date reporting

**API calls:**
- `GET /{campaign-id}/insights` — fetch campaign metrics

**Why needed:** Businesses need to see how their ads are performing without logging into Meta Ads Manager separately.

---

### PERMISSION: leads_retrieval
**Use Case:** Import leads from Meta Lead Gen Forms into CRM

**How it's used:**
- Fetch lead data (name, email, phone) from Lead Gen form submissions
- Automatically create CRM contacts from Meta leads
- Trigger follow-up automations (SMS, email) for new leads

**User flow:**
1. Someone fills out a Lead Gen form on a Meta ad
2. Platform syncs the lead data via API
3. Creates a CRM contact with the lead's information
4. Triggers any configured follow-up workflows

**API calls:**
- `GET /{form-id}/leads` — fetch lead submissions

**Why needed:** Lead forms are one of the most popular Meta ad formats. Automatic import into the CRM ensures no lead is lost and follow-up is immediate.

---

### PERMISSION: pages_manage_ads
**Use Case:** Access lead form data associated with Page ads

**How it's used:**
- Required alongside leads_retrieval to access lead forms connected to a Page
- List available lead forms for a Page

**API calls:**
- `GET /{page-id}/leadgen_forms` — list lead gen forms

**Why needed:** Required by Meta to access lead form data.

---

## 3. Data Use Declaration

### Data collected:
- Facebook Page messages (for unified inbox)
- Instagram DMs (for unified inbox)
- Facebook and Instagram comments (for AI auto-reply)
- Lead form submissions (name, email, phone — for CRM)
- Ad campaign performance metrics (impressions, clicks, spend)
- Page profile information (name, ID, linked Instagram account)

### Data storage:
- All data is stored in our PostgreSQL database, encrypted at rest
- Data is isolated per tenant — each business can only access their own data
- Credentials (access tokens) are stored server-side, never exposed to the browser
- App Secret Proof (HMAC) is used on all API calls for enhanced security

### Data sharing:
- We do NOT share any customer data with third parties
- We do NOT sell data
- We do NOT use customer data for our own advertising
- Data is only accessible to the business that owns it

### Data deletion:
- Users can request data deletion at any time
- We support Meta's Data Deletion Callback at `/api/data-deletion`
- Account deletion removes all associated Meta data from our system

---

## 4. Platform Details (for Submission Form)

**Platform:** Web Application
**App Type:** Business
**Category:** Business Services
**Privacy Policy URL:** https://apexmarketingautomations.com/privacy
**Terms of Service URL:** https://apexmarketingautomations.com/terms
**Data Deletion URL:** https://apexmarketingautomations.com/api/data-deletion
**App Domain:** apexmarketingautomations.com

---

## 5. Screencast Scripts

### Screencast 1: Unified Inbox (pages_messaging + instagram_manage_messages)
**Duration:** 60-90 seconds

1. Show login to Apex Marketing Automations
2. Navigate to "Meta Messaging" in sidebar
3. Show the unified inbox with Facebook and Instagram conversations
4. Click on a Facebook Messenger conversation — show message history
5. Type and send a reply — show it appears in the thread
6. Switch to an Instagram DM conversation
7. Read and reply to the Instagram DM
8. Narrate: "Our platform lets businesses manage all their Facebook and Instagram messages from one unified inbox, ensuring no customer message goes unanswered."

### Screencast 2: AI Comment Bot (instagram_manage_comments + pages_read_engagement)
**Duration:** 60-90 seconds

1. Show the Comment Bot settings page
2. Show existing auto-replies in the activity log
3. Show a new comment arriving (or reference the webhook flow)
4. Show the AI reading the post caption for context
5. Show the auto-generated reply posted on the comment
6. Show the toggle to enable/disable the bot per account
7. Narrate: "Our AI Comment Bot reads the post context and generates relevant replies to comments automatically, keeping businesses engaged with their audience 24/7."

### Screencast 3: Content Planner (pages_manage_posts + instagram_content_publish)
**Duration:** 60-90 seconds

1. Navigate to "Content Planner" in sidebar
2. Show the calendar view with scheduled posts
3. Create a new post — type text, upload an image
4. Select Facebook Page and/or Instagram as targets
5. Choose a publish date/time
6. Show the post being created/scheduled
7. Narrate: "The Content Planner lets businesses schedule posts to both Facebook and Instagram from a single calendar, maintaining consistent social media presence."

### Screencast 4: Ad Launcher (ads_management + ads_read)
**Duration:** 60-90 seconds

1. Navigate to "Ad Launcher" in sidebar
2. Show campaign creation flow — objective, targeting, budget
3. Show creative upload and ad copy
4. Show campaign being created
5. Navigate to analytics to show performance metrics syncing
6. Narrate: "The Ad Launcher simplifies Meta advertising for small businesses with guided campaign creation and real-time performance tracking."

### Screencast 5: Lead Sync (leads_retrieval + pages_manage_ads)
**Duration:** 60 seconds

1. Navigate to the Leads section or Meta Leads page
2. Show lead forms connected to the Page
3. Show leads imported into the CRM automatically
4. Show a contact record created from a Meta lead with name/email/phone
5. Narrate: "Meta Lead Gen form submissions are automatically synced into our CRM, ensuring instant follow-up and no lost leads."

---

## 6. Pre-Submission Checklist

### In Meta Developer Portal (developers.facebook.com):

- [ ] **App Settings > Basic**
  - App Display Name: "Apex Marketing Automations"
  - App Domains: apexmarketingautomations.com
  - Privacy Policy URL: https://apexmarketingautomations.com/privacy
  - Terms of Service URL: https://apexmarketingautomations.com/terms
  - App Icon uploaded
  - Category: "Business"

- [ ] **App Settings > Advanced**
  - Data Deletion Callback URL: https://apexmarketingautomations.com/api/data-deletion
  - Deauthorize Callback URL: https://apexmarketingautomations.com/api/auth/facebook/deauthorize

- [ ] **Products Added (in left sidebar)**
  - Facebook Login for Business
  - Messenger (for pages_messaging)
  - Instagram Basic Display / Instagram Graph API
  - Webhooks
  - Marketing API (for ads_management)
  - Meta Business Extension (optional)

- [ ] **Facebook Login > Settings**
  - Valid OAuth Redirect URIs: https://apexmarketingautomations.com/api/auth/meta/callback
  - Client OAuth Login: Yes
  - Web OAuth Login: Yes

- [ ] **Webhooks Configuration**
  - Page webhook subscribed to: messages, messaging_postbacks, feed, comments
  - Verify Token: matches META_VERIFY_TOKEN in your Secrets
  - Callback URL: https://apexmarketingautomations.com/api/meta-webhook

- [ ] **Business Verification**
  - Go to Meta Business Suite > Settings > Business Info
  - Complete business verification with official documents
  - Domain verification: add DNS TXT record or meta tag to apexmarketingautomations.com

### In Apex Marketing Automations codebase:

- [x] Privacy Policy page exists at /privacy
- [x] Terms of Service page exists at /terms
- [x] Data Deletion endpoint exists at /api/data-deletion
- [x] Deauthorize callback exists at /api/auth/facebook/deauthorize
- [x] Meta webhook endpoint exists at /api/meta-webhook
- [x] META_VERIFY_TOKEN configured
- [x] META_APP_SECRET configured
- [x] appsecret_proof implemented on all API calls
- [x] Per-tenant token isolation (each sub-account has own credentials)
- [x] Token debug/validation endpoint exists at /api/meta-ops/permissions

---

## 7. Permissions to Submit (in order of priority)

### Batch 1 — Core (submit first)
1. `pages_messaging`
2. `pages_read_engagement`
3. `pages_manage_metadata`
4. `instagram_basic`
5. `instagram_manage_messages`

### Batch 2 — Content & Comments
6. `instagram_manage_comments`
7. `pages_manage_posts`
8. `instagram_content_publish`

### Batch 3 — Advertising & Leads
9. `ads_management`
10. `ads_read`
11. `leads_retrieval`
12. `pages_manage_ads`

---

## 8. Test User Credentials (for Meta Reviewer)

Create a test account in your platform that Meta reviewers can use:
- **Login URL:** https://apexmarketingautomations.com/login
- **Email:** meta-reviewer@apexmarketingautomations.com
- **Password:** (create a secure password and provide it in the submission form)
- **Test Facebook Page:** Create a test Page connected to this account
- **Instructions:** After login, navigate to Meta Messaging to see inbox, Content Planner to see scheduling, and Ad Launcher to see campaign creation.

---

## 9. Common Rejection Reasons & How We Address Them

| Rejection Reason | Our Response |
|---|---|
| "App doesn't use the permission" | Each permission has a clear user-facing feature with screenshots |
| "No privacy policy" | Privacy policy at /privacy, Terms at /terms |
| "No data deletion" | Data deletion callback at /api/data-deletion |
| "Screencast doesn't show the feature" | Follow the screencast scripts above — show the actual UI |
| "App is in development mode" | Switch to Live mode only after all permissions are approved |
| "Business not verified" | Complete business verification before submitting |
