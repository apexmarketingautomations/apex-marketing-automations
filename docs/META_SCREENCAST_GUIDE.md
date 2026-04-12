# Meta App Review — Screencast Recording Guide

## What Are These Screencasts For?

When you submit your Meta app for review, Meta requires short video recordings showing how your app actually uses each permission you're requesting. A real human at Meta will watch these videos to verify your app does what you say it does.

**If your screencasts are unclear or don't show the right things, your app will be rejected.**

---

## General Recording Rules

### Setup Before Recording
- Use a screen recording tool (Loom, OBS, or QuickTime on Mac)
- Record your full browser window — Meta wants to see the URL bar so they know it's your real app
- Log into your platform at **https://apexmarketingautomations.com** (use the live/production site, NOT localhost)
- Use a real connected Facebook Page with some actual data (messages, comments, posts)
- Clear any sensitive customer data from view, or use a test account

### Recording Requirements
- **Length:** 60–120 seconds each (Meta rejects anything too long or too short)
- **Resolution:** At least 720p
- **Format:** MP4 or MOV
- **Audio:** Include a voice narration explaining what you're doing (Meta prefers this). Speak clearly and simply
- **No editing needed** — raw screen recording with narration is fine
- **No music** — just your voice

### What Meta Wants to See
1. You logging into your app (briefly — just show you're authenticated)
2. The specific feature that uses the permission
3. The feature actually working with real data (not empty/placeholder screens)
4. That the feature is useful to the end user (the business owner)

### What Gets You Rejected
- Recording localhost instead of your live domain
- Empty screens with no data
- Not showing the actual feature (just showing settings pages)
- Too long (over 2 minutes)
- No narration / silent video
- Showing features that don't match the permission you're requesting

---

## Screencast #1: Unified Inbox

**Permissions this covers:** `pages_messaging`, `instagram_manage_messages`

**What to show:** A business owner reading and replying to Facebook Messenger AND Instagram DMs from your platform.

### Step-by-Step Recording Script

1. **[5 seconds]** Show the login page. Log in to your platform.
   - Say: *"I'm logging into Apex Marketing Automations, our marketing platform for small businesses."*

2. **[5 seconds]** After login, show the dashboard briefly.
   - Say: *"This is the main dashboard. I'm going to navigate to the messaging inbox."*

3. **[5 seconds]** Click "Meta Messaging" or "Messages" in the sidebar.
   - Say: *"Here's our unified messaging inbox where businesses can see all their Facebook and Instagram messages in one place."*

4. **[15 seconds]** Show the inbox list with conversations. Click on a **Facebook Messenger** conversation.
   - Say: *"Here I can see conversations from Facebook Messenger. Let me open one."*
   - Show the message history loading — scroll through a few messages so Meta can see real content.

5. **[15 seconds]** Type a reply and send it.
   - Say: *"I can reply directly from our platform. The message is sent through the Facebook Pages API using the pages_messaging permission."*
   - Show the reply appearing in the thread after sending.

6. **[15 seconds]** Now click on an **Instagram DM** conversation.
   - Say: *"We also support Instagram Direct Messages. Here's an Instagram conversation."*
   - Show the Instagram messages loading.

7. **[10 seconds]** Type a reply to the Instagram DM and send it.
   - Say: *"I can reply to Instagram DMs the same way, using the instagram_manage_messages permission. This helps businesses respond to all their social messages without switching between apps."*

8. **[5 seconds]** Show the inbox list one more time.
   - Say: *"Both Facebook and Instagram conversations appear in one unified view."*

**Total time:** ~75 seconds

---

## Screencast #2: AI Comment Bot

**Permissions this covers:** `instagram_manage_comments`, `pages_read_engagement`, `instagram_basic`

**What to show:** The AI automatically replying to comments on Instagram posts.

### Step-by-Step Recording Script

1. **[5 seconds]** From the dashboard, navigate to the Comment Bot section.
   - Say: *"I'm going to show our AI Comment Bot feature, which automatically replies to comments on Instagram posts."*

2. **[10 seconds]** Show the Comment Bot settings/configuration page.
   - Say: *"Here are the comment bot settings. Business owners can enable or disable automatic replies and customize the AI's tone and behavior."*

3. **[10 seconds]** Show the toggle that enables/disables the bot. Show it's turned ON.
   - Say: *"The bot is currently active for this account."*

4. **[15 seconds]** Show the comment activity log / recent auto-replies.
   - Say: *"Here's the activity log showing recent auto-replies. The AI reads the original post caption using pages_read_engagement, then generates a contextual reply."*

5. **[15 seconds]** Click on one of the auto-replies to show detail — the original comment, the post it was on, and the AI's response.
   - Say: *"For example, on this post about [describe the post], someone commented [read the comment]. The AI used instagram_manage_comments to post this reply: [read the reply]. It understood the context because it read the post caption first."*

6. **[10 seconds]** Show the Instagram posts list (media backfill) — this demonstrates instagram_basic.
   - Say: *"We use instagram_basic to access the business's Instagram posts, so the AI knows which posts to monitor for new comments."*

7. **[5 seconds]** Wrap up.
   - Say: *"This helps small businesses engage with their audience 24/7 without manually replying to every comment."*

**Total time:** ~70 seconds

---

## Screencast #3: Content Planner

**Permissions this covers:** `pages_manage_posts`, `instagram_content_publish`

**What to show:** Scheduling and publishing a post to Facebook AND Instagram.

### Step-by-Step Recording Script

1. **[5 seconds]** Navigate to "Content Planner" in the sidebar.
   - Say: *"This is our Content Planner where businesses schedule and publish posts to Facebook and Instagram."*

2. **[10 seconds]** Show the calendar view with some existing scheduled posts.
   - Say: *"Here's the content calendar. You can see posts scheduled for different dates."*

3. **[15 seconds]** Click "Create Post" or "New Post." Fill in the post details:
   - Type some text for the caption
   - Upload an image
   - Say: *"I'm creating a new post. I'll add some text and an image."*

4. **[10 seconds]** Show the platform selector — check both Facebook and Instagram.
   - Say: *"I can publish to Facebook using pages_manage_posts, Instagram using instagram_content_publish, or both at the same time."*

5. **[10 seconds]** Select a date/time for the post (or choose "Publish Now").
   - Say: *"I'll schedule this for [date/time]. The platform will automatically publish it at that time."*

6. **[10 seconds]** Click "Schedule" or "Publish."
   - Say: *"The post is now scheduled. For Instagram, we use the two-step container and publish flow required by the Instagram Content Publishing API."*

7. **[10 seconds]** Show the post appearing on the calendar.
   - Say: *"The post now appears on the calendar. Business owners can plan their entire social media content weeks in advance from this single view."*

**Total time:** ~70 seconds

---

## Screencast #4: Ad Launcher & Analytics

**Permissions this covers:** `ads_management`, `ads_read`

**What to show:** Creating an ad campaign and viewing performance metrics.

### Step-by-Step Recording Script

1. **[5 seconds]** Navigate to "Ad Launcher" or "Meta Ads" in the sidebar.
   - Say: *"This is our Ad Launcher, which simplifies Meta ad campaign creation for small businesses."*

2. **[15 seconds]** Start creating a new campaign:
   - Select a campaign objective
   - Set targeting (location, age, interests)
   - Say: *"I'm creating a new campaign. I'll set the objective, target audience, and location targeting."*

3. **[15 seconds]** Continue the campaign setup:
   - Set a budget
   - Upload creative (image)
   - Write ad copy
   - Say: *"I'll set the daily budget, upload an image, and write the ad copy. We use ads_management to create this campaign in the business's Meta Ad Account."*

4. **[10 seconds]** Click "Launch" or "Create Campaign."
   - Say: *"The campaign is now being created through the Meta Marketing API."*

5. **[15 seconds]** Navigate to the analytics or campaign performance section. Show metrics.
   - Say: *"Here's our analytics dashboard. We use ads_read to sync campaign performance data — impressions, clicks, spend, cost per click, and click-through rate. This syncs automatically every 45 minutes so businesses always see up-to-date results."*

6. **[5 seconds]** Wrap up.
   - Say: *"This gives small businesses an easy way to run Meta ads without needing to learn the full Ads Manager."*

**Total time:** ~65 seconds

---

## Screencast #5: Lead Sync

**Permissions this covers:** `leads_retrieval`, `pages_manage_ads`

**What to show:** Meta Lead Gen form leads being imported into your CRM.

### Step-by-Step Recording Script

1. **[5 seconds]** Navigate to the Leads or Meta Leads section.
   - Say: *"I'm going to show how we automatically import leads from Meta Lead Gen forms into our CRM."*

2. **[10 seconds]** Show the list of lead forms connected to the Page.
   - Say: *"Here are the lead gen forms connected to this business's Facebook Page. We use pages_manage_ads to list the available forms."*

3. **[15 seconds]** Show leads that have been imported. Click on one to show the details (name, email, phone).
   - Say: *"These leads were automatically synced from Meta. Each lead shows the name, email, phone number, and which form they came from. We use leads_retrieval to fetch this data."*

4. **[15 seconds]** Navigate to the CRM / Contacts section. Show the same lead as a CRM contact.
   - Say: *"The lead is automatically created as a contact in our CRM. From here, the business can follow up via SMS, email, or add them to an automation workflow."*

5. **[10 seconds]** Show any follow-up automation or pipeline stage.
   - Say: *"New leads can be automatically placed into the sales pipeline and trigger follow-up messages, ensuring no lead goes cold."*

6. **[5 seconds]** Wrap up.
   - Say: *"This eliminates the manual process of downloading leads from Meta and importing them, saving businesses hours every week."*

**Total time:** ~60 seconds

---

## Screencast #6: Webhook & Page Setup

**Permissions this covers:** `pages_manage_metadata`

**What to show:** How your app subscribes to webhook events on a Page.

### Step-by-Step Recording Script

1. **[5 seconds]** Navigate to the Integrations or Meta Settings page.
   - Say: *"I'm going to show how our platform subscribes to Facebook Page webhooks to receive real-time notifications."*

2. **[10 seconds]** Show the Meta connection/integration status for an account.
   - Say: *"Here's the Meta integration status for this business account. You can see the connected Facebook Page and its current webhook subscriptions."*

3. **[15 seconds]** Show the permissions/diagnostics view (the one at `/api/meta-ops/permissions`).
   - Say: *"Our diagnostics view shows the current permissions granted and active webhook subscriptions. We use pages_manage_metadata to subscribe the Page to receive messages, comments, and lead notifications in real time."*

4. **[10 seconds]** Show a real-time event arriving (a new message or comment notification appearing).
   - Say: *"When a new message or comment comes in, Meta sends a webhook to our server, and the notification appears instantly in the dashboard. Without pages_manage_metadata, we couldn't receive these real-time updates."*

5. **[5 seconds]** Wrap up.
   - Say: *"This ensures businesses see new messages and comments immediately, rather than having to manually check Facebook."*

**Total time:** ~45 seconds

---

## After Recording

### File Naming
Name your files clearly:
- `screencast-1-unified-inbox.mp4`
- `screencast-2-comment-bot.mp4`
- `screencast-3-content-planner.mp4`
- `screencast-4-ad-launcher.mp4`
- `screencast-5-lead-sync.mp4`
- `screencast-6-webhook-setup.mp4`

### Upload Instructions
1. Go to **developers.facebook.com** → Your App → App Review → Permissions
2. For each permission, click "Request"
3. Upload the relevant screencast(s)
4. Paste the matching description from the `META_APP_REVIEW_PACKAGE.md` document
5. Submit

### Which Screencast Goes With Which Permission

| Permission | Upload Screencast # |
|---|---|
| `pages_messaging` | #1 (Unified Inbox) |
| `instagram_manage_messages` | #1 (Unified Inbox) |
| `pages_manage_metadata` | #6 (Webhook Setup) |
| `pages_read_engagement` | #2 (Comment Bot) |
| `instagram_basic` | #2 (Comment Bot) |
| `instagram_manage_comments` | #2 (Comment Bot) |
| `pages_manage_posts` | #3 (Content Planner) |
| `instagram_content_publish` | #3 (Content Planner) |
| `ads_management` | #4 (Ad Launcher) |
| `ads_read` | #4 (Ad Launcher) |
| `leads_retrieval` | #5 (Lead Sync) |
| `pages_manage_ads` | #5 (Lead Sync) |

---

## Quick Tips for Getting Approved First Try

1. **Use your production URL** — Meta checks the URL bar in the video. Use apexmarketingautomations.com, not localhost
2. **Show real data** — Have at least a few real messages, comments, and posts visible. Empty screens get rejected
3. **Narrate everything** — Talk through what you're doing. Silent videos are more likely to be rejected
4. **Keep it focused** — Each video should only show the features related to those specific permissions. Don't wander around the app
5. **Show the end result** — If you send a message, show it appearing in the thread. If you publish a post, show it on the calendar. Meta wants to see the action complete successfully
6. **Don't rush** — Speak at a normal pace. The reviewer needs to understand what's happening
7. **Record in English** — Meta reviewers typically review in English
8. **Test before recording** — Make sure everything actually works. If something errors during the screencast, it's an instant rejection
