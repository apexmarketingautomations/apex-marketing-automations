/* eslint-disable no-undef, no-empty */
// ═══════════════════════════════════════════════════════════════════
// RoomOS by Apex AI Smart Room — Shared Code (CB Dev Portal)
// Paste this into "Shared Code" in the Chaturbate app editor.
// ═══════════════════════════════════════════════════════════════════

var SETTINGS = {
  pro_mode: ($settings && $settings.pro_mode) || 'yes',
  goal_tokens: parseInt(($settings && $settings.goal_tokens) || '100', 10),
  performer_name: ($settings && $settings.performer_name) || 'babe',
  cb_username: ($settings && $settings.cb_username) || '',
  RoomOs_secret: ($settings && $settings.RoomOs_secret) || '',
  notice_interval: parseInt(($settings && $settings.notice_interval) || '111', 10),
  silence_threshold: parseInt(($settings && $settings.silence_threshold) || '10', 10),
  custom_welcome: ($settings && $settings.custom_welcome) || "We're live \u2014 Let's build something tonight",
  show_upgrade_prompt: ($settings && $settings.show_upgrade_prompt) || 'yes'
};

var SESSION = {
  tokens: 0,
  goal: SETTINGS.goal_tokens,
  goalReached: false,
  tipCount: 0,
  topTipper: '',
  topTipAmount: 0,
  tippers: {},
  lastTipTime: 0,
  silenceTimer: null,
  silenceCount: 0,
  isLive: false,
  startTime: 0,
  viewers: {}
};

var DISPLAY_NAME = SETTINGS.performer_name || SETTINGS.cb_username || 'babe';

function sendWebhook(payload) {
  if (!SETTINGS.cb_username || !SETTINGS.RoomOs_secret) return;
  try {
    $overlay.sendMessage({
      type: 'webhook',
      token: SETTINGS.RoomOs_secret,
      payload: payload
    });
  } catch (e) {}
}

function getGoalRemaining() {
  var remaining = SESSION.goal - SESSION.tokens;
  return remaining > 0 ? remaining : 0;
}

function getSessionTotal() {
  return SESSION.tokens;
}

function getGoalPercent() {
  if (SESSION.goal <= 0) return 100;
  return Math.min(100, Math.round((SESSION.tokens / SESSION.goal) * 100));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getHypeMsg() {
  var remaining = getGoalRemaining();
  var total = getSessionTotal();
  return pick([
    remaining + " tokens to goal \u2014 let's make it happen!",
    "who's finishing this goal? " + remaining + " left!",
    "session total: " + total + " \u2014 keep it rolling!",
    remaining + " tokens between us and glory!",
    "room's been good tonight\u2026 let's finish strong!"
  ]);
}

function getNearGoalMsg() {
  var remaining = getGoalRemaining();
  return pick([
    remaining + " tokens away \u2014 SO close!",
    "we are SO close\u2026 " + remaining + " to go!",
    "literally " + remaining + " away\u2026 who's the hero?",
    remaining + " away\u2026 I won't beg but\u2026 \uD83D\uDE0F",
    "almost there! just " + remaining + " more!"
  ]);
}

function getGoalReachedMsg() {
  return pick([
    "we did it!! goal " + SESSION.goal + " hit \u2014 you all are insane!",
    "YESSS!! goal hit \u2014 you all are amazing!",
    "goal SMASHED! " + SESSION.tokens + " tokens tonight!",
    "\uD83C\uDF89 GOAL REACHED! love this room!",
    "that's a wrap on the goal! " + SESSION.tokens + " total!"
  ]);
}

function getProHypeMsg() {
  if (SETTINGS.pro_mode !== 'yes') return getHypeMsg();
  var remaining = getGoalRemaining();
  var total = getSessionTotal();
  var pct = getGoalPercent();
  return pick([
    "\uD83D\uDD25 RoomOS Pro: " + pct + "% to goal \u2014 " + remaining + " left!",
    "\u26A1 session is at " + total + " tokens \u2014 room is on fire!",
    "RoomOS says: room energy is UP \u2014 keep tipping!",
    "\uD83D\uDCC8 " + pct + "% done \u2014 only " + remaining + " to go!",
    "\u26A1 Pro tip: top tipper gets VIP love \u2014 " + remaining + " to goal!"
  ]);
}

function getWelcomeMsg(username) {
  if (SESSION.tippers[username]) {
    var amt = SESSION.tippers[username];
    return pick([
      "welcome back " + username + "! you've tipped " + amt + " this session \u2764\uFE0F",
      username + " is back! legend status: " + amt + " tokens deep",
      "ayy " + username + "! good to see you again \uD83D\uDE4C"
    ]);
  }
  return pick([
    "hey " + username + "! welcome in \u2764\uFE0F",
    "welcome " + username + "! glad you're here \uD83D\uDE4C",
    username + " just joined \u2014 welcome!"
  ]);
}

function getTipThankMsg(username, amount) {
  if (amount >= 500) {
    return pick([
      "\uD83D\uDCA5 " + username + " just dropped " + amount + "!! absolute LEGEND!",
      "\uD83D\uDE31 " + username + " with " + amount + " tokens!! you're unreal!",
      username + " \u2014 " + amount + " tokens?! I'm speechless \uD83D\uDE4F"
    ]);
  }
  if (amount >= 100) {
    return pick([
      "\uD83D\uDD25 " + username + " tipped " + amount + "! you're amazing!",
      "big love to " + username + " for " + amount + " tokens! \u2764\uFE0F",
      username + " coming in HOT with " + amount + "! \uD83D\uDE4C"
    ]);
  }
  if (amount >= 25) {
    return pick([
      "thank you " + username + "! " + amount + " tokens \u2764\uFE0F",
      username + " \u2014 " + amount + " tokens! love it!",
      "\uD83D\uDE4F " + username + " with " + amount + "! thank you!"
    ]);
  }
  return pick([
    "thanks " + username + "! \u2764\uFE0F",
    "appreciate you " + username + "!",
    "\uD83D\uDE4C " + username + "!"
  ]);
}

function getSilenceMsg() {
  return pick([
    "room's been quiet for a bit\u2026 who's still here? \uD83D\uDC40",
    "it's getting quiet\u2026 let's wake this room up!",
    "silence detected \u2014 anyone alive out there? \uD83D\uDE02",
    "room check! show some love \u2764\uFE0F",
    "quiet room = missed moments \u2014 let's go!"
  ]);
}

function getUpgradeMsg() {
  if (SETTINGS.show_upgrade_prompt !== 'yes') return '';
  return pick([
    "\u26A1 This room runs on RoomOS \u2014 AI-powered smart room management. RoomOS.io",
    "\uD83E\uDD16 RoomOS Pro: real-time AI coaching, whale tracking, silence detection. RoomOS.io",
    "\uD83D\uDCC8 Want a smarter room? RoomOS handles it all. RoomOS.io"
  ]);
}

function checkSilence() {
  if (!SESSION.isLive) return;
  if (SETTINGS.silence_threshold <= 0) return;
  var now = Date.now();
  var elapsed = (now - SESSION.lastTipTime) / 1000;
  if (SESSION.lastTipTime > 0 && elapsed >= SETTINGS.silence_threshold && SESSION.silenceCount < 3) {
    SESSION.silenceCount++;
    try { $room.sendNotice(getSilenceMsg(), '', '#F87171', 'bold'); } catch (e) {}
  }
}

function resetSilence() {
  SESSION.silenceCount = 0;
  SESSION.lastTipTime = Date.now();
}

var noticeRotation = 0;
var lastNoticeTime = 0;

function maybeSendNotice() {
  if (!SESSION.isLive) return;
  if (SETTINGS.notice_interval <= 0) return;
  var now = Date.now();
  if (lastNoticeTime > 0 && (now - lastNoticeTime) < SETTINGS.notice_interval * 1000) return;
  lastNoticeTime = now;

  var remaining = getGoalRemaining();
  var msg = '';

  if (SESSION.goalReached) {
    if (noticeRotation % 3 === 0 && SETTINGS.show_upgrade_prompt === 'yes') {
      msg = getUpgradeMsg();
    } else {
      msg = getProHypeMsg();
    }
  } else if (remaining <= Math.round(SESSION.goal * 0.15)) {
    msg = getNearGoalMsg();
  } else {
    if (noticeRotation % 4 === 0 && SETTINGS.show_upgrade_prompt === 'yes') {
      msg = getUpgradeMsg();
    } else {
      msg = getProHypeMsg();
    }
  }

  noticeRotation++;
  if (msg) {
    try { $room.sendNotice(msg, '', '#6366F1', 'bold'); } catch (e) {}
  }
}

// ═══════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// Paste each handler into its respective event tab in the CB editor.
// ═══════════════════════════════════════════════════════════════════

// ── onAppStart ─────────────────────────────────────────────────────
// $onAppStart = function() {
//   try { $room.sendNotice(
//     '\u26A1 RoomOS by Apex AI Smart Room \u2014 loaded. ' +
//     (SETTINGS.custom_welcome || "Let's go!"),
//     '', '#6366F1', 'bold'
//   ); } catch (e) {}
// };

// ── onBroadcastStart ───────────────────────────────────────────────
// $onBroadcastStart = function() {
//   SESSION.isLive = true;
//   SESSION.startTime = Date.now();
//   SESSION.tokens = 0;
//   SESSION.tipCount = 0;
//   SESSION.goalReached = false;
//   SESSION.tippers = {};
//   SESSION.topTipper = '';
//   SESSION.topTipAmount = 0;
//   SESSION.viewers = {};
//   SESSION.lastTipTime = Date.now();
//   sendWebhook({ event: 'broadcast_start', username: SETTINGS.cb_username });
//   try { $room.sendNotice(
//     '\uD83D\uDD34 ' + DISPLAY_NAME + ' is LIVE! ' +
//     (SETTINGS.custom_welcome || "Let's build something tonight"),
//     '', '#F87171', 'bold'
//   ); } catch (e) {}
// };

// ── onBroadcastEnd ─────────────────────────────────────────────────
// $onBroadcastEnd = function() {
//   SESSION.isLive = false;
//   sendWebhook({ event: 'broadcast_end', username: SETTINGS.cb_username });
//   try { $room.sendNotice(
//     '\uD83D\uDC4B Stream ended \u2014 ' + SESSION.tokens + ' tokens tonight. See you next time!',
//     '', '#6366F1', 'bold'
//   ); } catch (e) {}
// };

// ── onTipReceived ──────────────────────────────────────────────────
// $onTip = function(tip) {
//   var username = tip.from_user;
//   var amount = parseInt(tip.amount, 10) || 0;
//   SESSION.tokens += amount;
//   SESSION.tipCount++;
//   SESSION.tippers[username] = (SESSION.tippers[username] || 0) + amount;
//   if (SESSION.tippers[username] > SESSION.topTipAmount) {
//     SESSION.topTipAmount = SESSION.tippers[username];
//     SESSION.topTipper = username;
//   }
//   resetSilence();
//   sendWebhook({
//     event: 'tip',
//     username: SETTINGS.cb_username,
//     user: username,
//     amount: amount
//   });
//   try { $room.sendNotice(getTipThankMsg(username, amount), '', '#F87171', 'bold'); } catch (e) {}
//   maybeSendNotice();
//   if (!SESSION.goalReached && SESSION.tokens >= SESSION.goal) {
//     SESSION.goalReached = true;
//     try { $room.sendNotice(getGoalReachedMsg(), '', '#22C55E', 'bold'); } catch (e) {}
//   }
// };

// ── onUserEnter ────────────────────────────────────────────────────
// $onEnter = function(user) {
//   var username = user.user;
//   SESSION.viewers[username] = Date.now();
//   sendWebhook({
//     event: 'enter',
//     username: SETTINGS.cb_username,
//     user: username
//   });
//   checkSilence();
//   maybeSendNotice();
//   try { $room.sendNotice(getWelcomeMsg(username), '', '#6366F1'); } catch (e) {}
// };

// ── onChatMessage ──────────────────────────────────────────────────
// $onMessage = function(msg) {
//   checkSilence();
//   return msg;
// };
