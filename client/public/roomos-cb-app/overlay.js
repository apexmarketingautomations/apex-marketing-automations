// ═══════════════════════════════════════════════════════════════════
// RoomOS by Apex AI Smart Room — Overlay JS (CB Dev Portal)
// Paste this into "Overlay JS" in the Chaturbate app editor.
// ═══════════════════════════════════════════════════════════════════

var SETTINGS = {
  pro_mode: 'yes',
  goal_tokens: 100,
  performer_name: '',
  cb_username: '',
  silence_threshold: 10,
  custom_welcome: "We're live \u2014 Let's build something tonight",
  show_upgrade_prompt: 'yes'
};

var WEBHOOK_URL = 'https://apexmarketingautomations.com/api/chaturbate/webhook';

window.addEventListener('message', function(evt) {
  try {
    var msg = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
    if (!msg || msg.type !== 'webhook') return;
    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-roomos-token': msg.token || ''
      },
      body: JSON.stringify(msg.payload || {})
    }).catch(function() {});
  } catch (e) {}
});

var GOAL = SETTINGS.goal_tokens;
var GOAL_PCT = 90;
var GOAL_CURRENT = Math.round(GOAL * GOAL_PCT / 100);
var DISPLAY_NAME = SETTINGS.performer_name || SETTINGS.cb_username || '';

var HOOKS = [
  {
    lines: ['STOP GUESSING.', 'START <span class="red">EARNING</span>.'],
    sub: 'RoomOS \u2014 Intelligent Room Management'
  },
  {
    lines: ['YOUR ROOM IS', '<span class="red">LEAKING</span> MONEY'],
    sub: "See What You're Missing"
  },
  {
    lines: ['WHAT IF YOUR ROOM', 'RAN <span class="indigo">ITSELF</span>?'],
    sub: 'Automation That Works While You Work'
  },
  {
    lines: ['THE <span class="red">FUTURE</span> OF CAM', 'IS <span class="indigo">HERE</span>'],
    sub: 'Real-Time Intelligence For Your Room'
  },
  {
    lines: ['EVERY SECOND <span class="red">COUNTS</span>.', 'EVERY TIP <span class="indigo">MATTERS</span>.'],
    sub: 'Track Everything. Miss Nothing.'
  }
];

var BOLT = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

function hookSlide(hook) {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div class="hook-text anim-up">' + ((hook.lines && hook.lines[0]) || '') + '</div>\
      <div class="hook-text anim-up d1" style="margin-top:4px">' + ((hook.lines && hook.lines[1]) || '') + '</div>\
      <div class="hook-sub anim-up d2">' + hook.sub + '</div>\
    </div>\
  </div>';
}

function logoSlide(useVideo) {
  if (useVideo) {
    return '\
    <div class="slide">\
      <div class="slide-inner">\
        <div class="logo-container">\
          <div class="logo-video-wrap anim-scale">\
            <video src="/roomos-logo.mp4" autoplay muted loop playsinline></video>\
          </div>\
          <div class="logo-title anim-up d1"><span class="room">Room</span><span class="os">OS</span></div>\
          <div class="logo-powered anim-up d2">Powered By <span>Apex</span></div>\
        </div>\
      </div>\
    </div>';
  }
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div class="logo-container">\
        <div class="logo-icon anim-scale">\
          <div class="logo-glow-red"></div>\
          <div class="logo-glow-indigo"></div>\
          <div class="logo-sweep"></div>\
          ' + BOLT + '\
        </div>\
        <div class="logo-title anim-up d1"><span class="room">Room</span><span class="os">OS</span></div>\
        <div class="logo-powered anim-up d2">Powered By <span>Apex</span></div>\
      </div>\
    </div>\
  </div>';
}

function featureSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div class="feature-label anim-up">AI-POWERED COACHING</div>\
      <div class="feature-headline anim-up d1">Real-Time Suggestions. Powered By Your <span class="accent">Live Chat Data</span>.</div>\
      <div class="feature-desc anim-up d2">RoomOS Reads Your Chat In Real Time And Delivers The Right Move At The Right Moment.</div>\
    </div>\
  </div>';
}

function sessionSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:24px">\
        <div class="session-label anim-up">LIVE SESSION</div>\
        <div class="session-panel anim-scale d1">\
          <div class="session-header">\
            <div class="session-brand">Room<span class="os">OS</span></div>\
            <div class="session-live"><div class="session-live-dot"></div> LIVE</div>\
          </div>\
          <div class="session-big-num">\
            <div class="session-big-val" data-count="951">0</div>\
            <div class="session-big-label">Tokens This Session</div>\
          </div>\
          <div class="session-bar"><div class="session-bar-fill" style="width:0%"></div></div>\
          <div class="session-bar-meta">\
            <span class="session-bar-goal">Goal: ' + GOAL_CURRENT + ' / ' + GOAL + '</span>\
            <span class="session-bar-pct">' + GOAL_PCT + '%</span>\
          </div>\
          <div class="session-tip">\
            <div>\
              <div class="session-tip-user">n877</div>\
              <div class="session-tip-tag">VIP Every Time</div>\
            </div>\
            <div class="session-tip-amt">+301</div>\
          </div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function whaleSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center">\
        <div class="whale-headline anim-up">Know Your <span class="red">Top Whale</span></div>\
        <div class="whale-hero">\
          <div class="whale-avatar anim-scale d1">B</div>\
          <div class="whale-hero-name anim-up d2">BigDave99</div>\
          <div class="whale-hero-amount anim-up d3" data-count-whale="4280">$0</div>\
          <div class="whale-hero-label anim-up d3">Lifetime Total</div>\
          <div class="whale-hero-visits anim-up d4">47 Sessions \u2014 Always Comes Back</div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function phoneSlide() {
  var welcomeText = DISPLAY_NAME ? ' Welcome Them Back, ' + DISPLAY_NAME + '.' : ' Welcome Them Back.';
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center">\
        <div class="phone-label anim-up">MOBILE COMMAND CENTER</div>\
        <div class="phone-headline anim-up d1">Your Room. Your Phone.</div>\
        <div class="phone-device anim-scale d1">\
          <div class="phone-island"></div>\
          <div class="phone-screen">\
            <div class="phone-status-bar">\
              <div class="phone-time">9:41</div>\
              <div class="phone-icons">\
                <div class="phone-icon-bar" style="height:5px"></div>\
                <div class="phone-icon-bar" style="height:7px"></div>\
                <div class="phone-icon-bar" style="height:9px"></div>\
                <div class="phone-icon-bar" style="height:11px"></div>\
              </div>\
            </div>\
            <div class="phone-app-header">\
              <div class="phone-app-title">Room<span class="os">OS</span></div>\
              <div class="phone-live-badge"><span class="phone-live-dot"></span>LIVE</div>\
            </div>\
            <div class="phone-metric">\
              <div class="phone-metric-val" data-count-phone="1247">0</div>\
              <div class="phone-metric-label">Tokens This Session</div>\
            </div>\
            <div class="phone-tip-item">\
              <div class="phone-tip-user">KingVIP</div>\
              <div class="phone-tip-amt">+500</div>\
            </div>\
            <div class="phone-tip-item">\
              <div class="phone-tip-user">n877</div>\
              <div class="phone-tip-amt">+301</div>\
            </div>\
            <div class="phone-suggestion">\
              <div class="phone-sug-label">AI SUGGESTION</div>\
              <div class="phone-sug-text">KingVIP Is Back \u2014 They Tipped 500 Last Session.' + welcomeText + '</div>\
            </div>\
          </div>\
          <div class="phone-screen-pulse"></div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function pricingSlide() {
  if (SETTINGS.pro_mode !== 'yes') return '';
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div class="price-hero">\
        <div class="price-label anim-up">PRO PLAN</div>\
        <div class="price-headline anim-up d1">Everything You Need</div>\
        <div class="price-amount anim-up d2"><span class="dollar">$</span>49<span class="period">/Mo</span></div>\
        <div class="price-tier anim-up d3">AI COACHING + WHALE TRACKER + SILENCE DETECTION</div>\
        <div class="price-features anim-up d4">\
          <div class="price-feat">Real-Time Suggestions</div>\
          <div class="price-feat">Session Analytics</div>\
          <div class="price-feat">Priority Support</div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function ctaSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div class="cta-wrapper">\
        <div class="cta-logo-row anim-scale">\
          <div class="cta-logo-box"><div class="logo-sweep"></div>' + BOLT + '</div>\
          <div class="cta-brand"><span class="room">Room</span><span class="os">OS</span></div>\
        </div>\
        <div class="cta-url anim-up d1">RoomOS.io</div>\
        <div class="cta-tagline anim-up d2">Your Room. Smarter. Every Session.</div>\
        <div class="cta-powered anim-up d3">Powered By <span>Apex</span></div>\
      </div>\
    </div>\
  </div>';
}

function silenceSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:28px">\
        <div class="demo-section-label anim-up">FEATURE SHOWCASE</div>\
        <div class="feature-label anim-up">SILENCE DETECTION</div>\
        <div class="silence-alert anim-scale d1">\
          <div class="silence-icon"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.49-.34 2.18"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></div>\
          <div class="silence-title">SILENCE DETECTED</div>\
          <div class="silence-timer">Room Quiet For <span data-count-silence="' + SETTINGS.silence_threshold + '">0</span>s</div>\
        </div>\
        <div class="silence-recovery anim-up d2">Auto-Triggered: Poll Launched</div>\
      </div>\
    </div>\
  </div>';
}

function smartGoalSlide() {
  var goalAdjusted = Math.round(GOAL * 1.5);
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:28px">\
        <div class="feature-label anim-up">SMART GOAL SYSTEM</div>\
        <div class="goal-panel anim-scale d1">\
          <div class="goal-numbers">\
            <div class="goal-current" data-count-goal="' + (GOAL - 13) + '">0</div>\
            <div class="goal-target"><span class="goal-target-val">/ ' + GOAL + '</span></div>\
          </div>\
          <div class="goal-bar-outer"><div class="goal-bar-fill"></div></div>\
          <div class="goal-status goal-status-text" style="opacity:0;transition:opacity 0.5s">Goal Auto-Adjusted \u2014 Room Is Hot</div>\
        </div>\
        <div class="demo-headline anim-up d2" style="font-size:32px">Target Moved From ' + GOAL + ' \u2192 <span class="indigo">' + goalAdjusted + '</span></div>\
      </div>\
    </div>\
  </div>';
}

function analyticsSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:28px">\
        <div class="feature-label anim-up">SESSION ANALYTICS</div>\
        <div class="demo-headline anim-up d1" style="font-size:36px">Viewer <span class="red">Heatmap</span></div>\
        <div class="heatmap-timeline anim-scale d1">\
          <div class="heatmap-bar" id="heatmap-bar"></div>\
          <div class="heatmap-labels"><span>8:00 PM</span><span>9:00 PM</span><span>10:00 PM</span><span>11:00 PM</span></div>\
        </div>\
        <div class="heatmap-stat anim-up d2">\
          <div class="heatmap-stat-val">Peak: 9:47 PM \u2014 312 Tokens In 4 Minutes</div>\
          <div class="heatmap-stat-label">Post-Session Insight</div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function whaleCrmSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:24px">\
        <div class="feature-label anim-up">WHALE CRM</div>\
        <div class="crm-card anim-scale d1">\
          <div class="crm-header">\
            <div class="crm-avatar">B</div>\
            <div>\
              <div class="crm-name">BigDave99</div>\
              <div class="crm-tag">VIP WHALE</div>\
            </div>\
          </div>\
          <div class="crm-stats" style="grid-template-columns:1fr 1fr">\
            <div class="crm-stat"><div class="crm-stat-val">47</div><div class="crm-stat-label">Visits</div></div>\
            <div class="crm-stat"><div class="crm-stat-val">$4,280</div><div class="crm-stat-label">Lifetime</div></div>\
            <div class="crm-stat"><div class="crm-stat-val">$91</div><div class="crm-stat-label">Avg Tip</div></div>\
            <div class="crm-stat"><div class="crm-stat-val" style="font-size:16px">2 Days Ago</div><div class="crm-stat-label">Last Visit</div></div>\
          </div>\
          <div class="crm-welcome anim-up d2">\
            <div class="crm-welcome-label">PREFERRED WELCOME</div>\
            <div class="crm-welcome-text">"' + SETTINGS.custom_welcome + '"</div>\
          </div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function benchmarkSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:28px">\
        <div class="feature-label anim-up">MULTI-ROOM BENCHMARKING</div>\
        <div class="bench-rank anim-scale d1">\
          <div class="bench-position">Your Room: Top <span>12%</span></div>\
          <div class="bench-bar-outer">\
            <div class="bench-bar-fill"></div>\
            <div class="bench-bar-marker"></div>\
          </div>\
          <div class="bench-compare">\
            <div class="bench-stat">\
              <div class="bench-stat-val">$347</div>\
              <div class="bench-stat-label">Your Avg Session</div>\
            </div>\
            <div class="bench-stat">\
              <div class="bench-stat-val platform">$189</div>\
              <div class="bench-stat-label">Platform Average</div>\
            </div>\
          </div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function scheduleSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:24px">\
        <div class="feature-label anim-up">SCHEDULED AUTOMATION</div>\
        <div class="sched-block anim-scale d1">\
          <div class="sched-time">8PM \u2013 12AM</div>\
          <div class="sched-mode">PEAK HOURS MODE</div>\
          <div class="sched-trigger"><div class="sched-trigger-dot"></div><div class="sched-trigger-text">Whale Alerts: ON</div></div>\
          <div class="sched-trigger"><div class="sched-trigger-dot"></div><div class="sched-trigger-text">Silence Recovery: ' + SETTINGS.silence_threshold + 's</div></div>\
          <div class="sched-trigger"><div class="sched-trigger-dot"></div><div class="sched-trigger-text">Goal Pressure: Aggressive</div></div>\
        </div>\
        <div class="demo-headline anim-up d2" style="font-size:28px">Your Room Runs On <span class="indigo">Autopilot</span></div>\
      </div>\
    </div>\
  </div>';
}

function aiSuggestSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:24px">\
        <div class="feature-label anim-up">AI CONTENT SUGGESTIONS</div>\
        <div class="suggest-card anim-scale d1">\
          <div class="suggest-trending">TRENDING FORMAT</div>\
          <div class="suggest-title">Try: Countdown Tip Race \u2014 Top 3 Tippers Win</div>\
          <div class="suggest-sub">Based On 2,400 Rooms This Week</div>\
        </div>\
        <div class="demo-headline anim-up d2" style="font-size:28px">Platform Intelligence, <span class="red">Surfaced</span></div>\
      </div>\
    </div>\
  </div>';
}

function moodSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:24px">\
        <div class="feature-label anim-up">ROOM MOOD DETECTION</div>\
        <div class="mood-indicator anim-scale d1">\
          <div class="mood-energy">ROOM ENERGY: <span class="rising">RISING \u2191</span></div>\
          <div class="mood-graph">\
            <svg viewBox="0 0 400 80" preserveAspectRatio="none">\
              <polyline class="mood-graph-glow" points="0,70 40,65 80,60 120,55 160,48 200,42 240,35 280,25 320,18 360,12 400,5"/>\
              <polyline class="mood-graph-line" points="0,70 40,65 80,60 120,55 160,48 200,42 240,35 280,25 320,18 360,12 400,5"/>\
            </svg>\
          </div>\
          <div class="mood-sentiment">Chat Sentiment: <span>Positive</span> \u2014 Keep This Energy</div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function tipForecastSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:24px">\
        <div class="feature-label anim-up">TIP PATTERN FORECASTING</div>\
        <div class="predict-card anim-scale d1">\
          <div class="predict-user">\
            <div class="predict-avatar">B</div>\
            <div>\
              <div class="predict-name">BigDave99</div>\
              <div class="predict-chance">83% Likely To Tip</div>\
            </div>\
          </div>\
          <div class="predict-bar-outer"><div class="predict-bar-fill"></div></div>\
          <div class="predict-bar-label"><span>CONFIDENCE</span><span>83%</span></div>\
          <div class="predict-pattern"><span>Pattern:</span> Tips Within 5 Min Of Entry</div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function fanOverlaySlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:20px">\
        <div class="fan-view-badge anim-up">FAN VIEW</div>\
        <div class="feature-label anim-up">LIVE ROOM OVERLAY</div>\
        <div class="fan-overlay anim-scale d1">\
          <div class="fan-stream-area"><div class="fan-stream-placeholder">LIVE STREAM AREA</div></div>\
          <div class="fan-overlay-label">VIEWER PERSPECTIVE</div>\
          <div class="fan-goal-bar">\
            <div class="fan-goal-outer"><div class="fan-goal-fill"></div></div>\
            <div class="fan-goal-text"><span>GOAL: ' + GOAL_CURRENT + ' / ' + GOAL + '</span><span>' + GOAL_PCT + '%</span></div>\
          </div>\
          <div class="fan-tip-feed">\
            <div class="fan-tip-entry"><div class="fan-tip-name">KingVIP</div><div class="fan-tip-val">+500</div></div>\
            <div class="fan-tip-entry"><div class="fan-tip-name">n877</div><div class="fan-tip-val">+301</div></div>\
            <div class="fan-tip-entry"><div class="fan-tip-name">LuckyAce</div><div class="fan-tip-val">+120</div></div>\
          </div>\
          <div class="fan-countdown">\
            <div class="fan-countdown-val" data-count-fan-cd="4">0</div>\
            <div class="fan-countdown-label">MINUTES REMAINING</div>\
          </div>\
          <div class="fan-prompt">Tip <span>50</span> To Spin The Wheel</div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function fanCelebrateSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:20px">\
        <div class="fan-view-badge anim-up">FAN VIEW</div>\
        <div class="feature-label anim-up">ENGAGEMENT MOMENT</div>\
        <div class="fan-celebrate anim-scale d1">\
          <div class="fan-celebrate-banner">\
            <div class="fan-celebrate-emoji">\uD83C\uDF89</div>\
            <div class="fan-celebrate-text"><span class="name">KingVIP</span> Tipped <span class="amount">500!</span></div>\
          </div>\
          <div class="fan-celebrate-goal anim-up d2">\
            <div class="fan-celebrate-goal-label"><span>ROOM GOAL</span><span>' + GOAL_CURRENT + ' / ' + GOAL + '</span></div>\
            <div class="fan-celebrate-goal-bar"><div class="fan-celebrate-goal-fill"></div></div>\
          </div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function fanSmartPromptSlide() {
  return '\
  <div class="slide">\
    <div class="slide-inner">\
      <div style="display:flex;flex-direction:column;align-items:center;gap:20px">\
        <div class="fan-view-badge anim-up">FAN VIEW</div>\
        <div class="feature-label anim-up">SMART PROMPT</div>\
        <div class="fan-nudge anim-scale d1">\
          <div class="fan-nudge-chatarea">\
            <div class="fan-nudge-msg"><div class="fan-nudge-msg-avatar">K</div><div class="fan-nudge-msg-text"><span class="user">KingVIP:</span> Great show tonight \uD83D\uDD25</div></div>\
            <div class="fan-nudge-msg"><div class="fan-nudge-msg-avatar">L</div><div class="fan-nudge-msg-text"><span class="user">LuckyAce:</span> Let\'s goooo</div></div>\
            <div class="fan-nudge-msg"><div class="fan-nudge-msg-avatar">n</div><div class="fan-nudge-msg-text"><span class="user">n877:</span> \uD83D\uDE4C\uD83D\uDE4C\uD83D\uDE4C</div></div>\
          </div>\
          <div class="fan-nudge-prompt anim-up d2">\
            <div class="fan-nudge-prompt-icon">ROOMOS</div>\
            <div class="fan-nudge-prompt-text">Room Goal Is <span>' + GOAL_PCT + '%</span> \u2014 Help Push It Over!</div>\
          </div>\
        </div>\
      </div>\
    </div>\
  </div>';
}

function dashboardSlide() {
  return '\
  <div class="slide">\
    <div class="dash" id="dash-live">\
      <div class="dash-center-money">\
        <div class="dash-token-val" data-count-dash-main="4280">$0</div>\
        <div class="dash-token-label">Session Tokens</div>\
        <div class="dash-token-goal">\
          <div class="dash-goal-bar"><div class="dash-goal-fill"></div></div>\
          <div class="dash-goal-meta"><span>Goal: ' + GOAL_CURRENT + ' / ' + GOAL + '</span><span class="pct">' + GOAL_PCT + '%</span></div>\
        </div>\
      </div>\
      <div class="dash-left-ai">\
        <div class="dash-ai-float">\
          <div class="dash-ai-float-tag">AI COACHING \u2014 LIVE</div>\
          <div class="dash-ai-float-msg">"<span class="hl">Top 3 Get VIP Access</span> \u2014 Push Now"</div>\
        </div>\
        <div class="dash-ai-float">\
          <div class="dash-ai-float-tag">SILENCE DETECTION</div>\
          <div class="dash-ai-float-msg">No Tips In <span class="hl">2m 12s</span> \u2014 Recovery Triggered</div>\
          <div class="dash-ai-float-sub">Auto-Poll Deployed To Chat</div>\
        </div>\
        <div class="dash-ai-float">\
          <div class="dash-ai-float-tag">CONTENT SUGGESTION</div>\
          <div class="dash-ai-float-msg">Try <span class="hl">Countdown Tip Race</span> \u2014 Top 3 Win</div>\
          <div class="dash-ai-float-sub">Trending In 2,400 Rooms This Week</div>\
        </div>\
        <div class="dash-ai-float">\
          <div class="dash-ai-float-tag">ROOM MOOD</div>\
          <div class="dash-ai-float-msg">Mood: <span class="hl">Cooling</span> \u2014 Push Engagement Now</div>\
          <div class="dash-ai-float-sub">Sentiment Dropped 12% In 3 Min</div>\
        </div>\
      </div>\
      <div class="dash-right-money">\
        <div class="dash-whale-alert-box">\
          <div class="dash-whale-alert-tag">WHALE ALERT</div>\
          <div class="dash-whale-alert-name">BigDave99</div>\
          <div class="dash-whale-alert-meta">Lifetime: <span>$4,280</span> \u2014 47 Visits</div>\
        </div>\
        <div class="dash-top-tippers">\
          <div class="dash-top-tippers-title">TOP TIPPERS</div>\
          <div class="dash-tipper-row"><div class="dash-tipper-name">n877</div><div class="dash-tipper-amt">301</div></div>\
          <div class="dash-tipper-row"><div class="dash-tipper-name">KingVIP</div><div class="dash-tipper-amt">500</div></div>\
          <div class="dash-tipper-row"><div class="dash-tipper-name">LuckyAce</div><div class="dash-tipper-amt">120</div></div>\
        </div>\
        <div class="dash-predict-float">\
          <div class="dash-predict-tag">PREDICTION</div>\
          <div class="dash-predict-msg">BigDave99 <span>83%</span> Likely To Tip Next</div>\
        </div>\
      </div>\
      <div class="dash-bottom-bar">\
        <div class="dash-bottom-item"><div class="dash-status-dot"></div><span class="val">LIVE</span></div>\
        <div class="dash-bottom-item">VIEWERS: <span class="val">847</span></div>\
        <div class="dash-bottom-item">TIPS/HR: <span class="val red">$312</span></div>\
        <div class="dash-bottom-item">MOOD: <span class="val indigo">RISING</span><div class="dash-mini-bar"><div class="dash-mini-fill"></div></div></div>\
        <div class="dash-bottom-item">AI: <span class="val indigo">ACTIVE</span></div>\
      </div>\
    </div>\
  </div>';
}

// ═══════════════════════════════════════════════════════════════════
// SLIDE ENGINE — rotation, animations, counters, HUD
// ═══════════════════════════════════════════════════════════════════

var SLIDE_DURATION = 30000;
var TRANSITION_DURATION = 400;
var slides = [];
var currentSlide = -1;
var slideTimer = null;
var overlayStartTime = Date.now();

function buildSlides() {
  var bb = document.getElementById('billboard');
  if (!bb) return;

  var slideHtml = '';
  slideHtml += logoSlide(false);

  for (var i = 0; i < HOOKS.length; i++) {
    slideHtml += hookSlide(HOOKS[i]);
  }

  slideHtml += featureSlide();
  slideHtml += sessionSlide();
  slideHtml += whaleSlide();
  slideHtml += phoneSlide();
  slideHtml += silenceSlide();
  slideHtml += smartGoalSlide();
  slideHtml += analyticsSlide();
  slideHtml += whaleCrmSlide();
  slideHtml += benchmarkSlide();
  slideHtml += scheduleSlide();
  slideHtml += aiSuggestSlide();
  slideHtml += moodSlide();
  slideHtml += tipForecastSlide();
  slideHtml += fanOverlaySlide();
  slideHtml += fanCelebrateSlide();
  slideHtml += fanSmartPromptSlide();
  slideHtml += dashboardSlide();
  slideHtml += pricingSlide();
  slideHtml += ctaSlide();

  bb.innerHTML = slideHtml;
  slides = bb.querySelectorAll('.slide');
}

function showSlide(index) {
  if (slides.length === 0) return;
  var nextIndex = index % slides.length;

  if (currentSlide >= 0 && currentSlide < slides.length) {
    var prev = slides[currentSlide];
    prev.classList.remove('active');
    prev.classList.add('exiting');
    setTimeout(function() {
      prev.classList.remove('exiting');
    }, TRANSITION_DURATION);
  }

  var next = slides[nextIndex];
  next.classList.add('entering', 'active');
  setTimeout(function() {
    next.classList.remove('entering');
  }, TRANSITION_DURATION);

  currentSlide = nextIndex;
  animateSlideElements(next);
}

function animateSlideElements(slide) {
  var counters = slide.querySelectorAll('[data-count]');
  for (var i = 0; i < counters.length; i++) {
    animateCounter(counters[i], 'data-count');
  }

  var whaleCounters = slide.querySelectorAll('[data-count-whale]');
  for (var j = 0; j < whaleCounters.length; j++) {
    animateCounter(whaleCounters[j], 'data-count-whale', '$');
  }

  var phoneCounters = slide.querySelectorAll('[data-count-phone]');
  for (var k = 0; k < phoneCounters.length; k++) {
    animateCounter(phoneCounters[k], 'data-count-phone');
  }

  var silenceCounters = slide.querySelectorAll('[data-count-silence]');
  for (var l = 0; l < silenceCounters.length; l++) {
    animateCounter(silenceCounters[l], 'data-count-silence');
  }

  var goalCounters = slide.querySelectorAll('[data-count-goal]');
  for (var m = 0; m < goalCounters.length; m++) {
    animateCounter(goalCounters[m], 'data-count-goal');
  }

  var dashCounters = slide.querySelectorAll('[data-count-dash-main]');
  for (var n = 0; n < dashCounters.length; n++) {
    animateCounter(dashCounters[n], 'data-count-dash-main', '$');
  }

  var fanCdCounters = slide.querySelectorAll('[data-count-fan-cd]');
  for (var p = 0; p < fanCdCounters.length; p++) {
    animateCounter(fanCdCounters[p], 'data-count-fan-cd');
  }

  setTimeout(function() {
    var bars = slide.querySelectorAll('.session-bar-fill, .goal-bar-fill, .bench-bar-fill, .predict-bar-fill, .fan-goal-fill, .fan-celebrate-goal-fill, .dash-goal-fill, .dash-mini-fill');
    for (var b = 0; b < bars.length; b++) {
      bars[b].style.width = (Math.round(Math.random() * 30 + 65)) + '%';
    }
    var markers = slide.querySelectorAll('.bench-bar-marker');
    for (var c = 0; c < markers.length; c++) {
      markers[c].style.left = '88%';
    }
    var moodLines = slide.querySelectorAll('.mood-graph-line, .mood-graph-glow');
    for (var d = 0; d < moodLines.length; d++) {
      moodLines[d].style.strokeDashoffset = '0';
    }
    var goalStatus = slide.querySelector('.goal-status-text');
    if (goalStatus) {
      setTimeout(function() { goalStatus.style.opacity = '1'; }, 1500);
    }
    var heatmapBar = slide.querySelector('#heatmap-bar');
    if (heatmapBar && !heatmapBar.hasChildNodes()) {
      var segHtml = '';
      for (var s = 0; s < 24; s++) {
        var h = Math.round(Math.random() * 26 + 6);
        var r = Math.round(113 + Math.random() * 135);
        var g = Math.round(50 + Math.random() * 50);
        segHtml += '<div class="heatmap-segment" style="height:' + h + 'px;background:rgba(' + r + ',' + g + ',113,0.7)"></div>';
      }
      heatmapBar.innerHTML = segHtml;
    }
  }, 200);
}

function animateCounter(el, attr, prefix) {
  var target = parseInt(el.getAttribute(attr), 10) || 0;
  var duration = 2000;
  var start = Date.now();
  prefix = prefix || '';

  function tick() {
    var elapsed = Date.now() - start;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(target * eased);
    el.textContent = prefix + current.toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  }
  tick();
}

function startRotation() {
  showSlide(0);
  slideTimer = setInterval(function() {
    showSlide(currentSlide + 1);
  }, SLIDE_DURATION);
}

function updateHudClock() {
  var clockEl = document.getElementById('hud-clock');
  if (clockEl) {
    var now = new Date();
    clockEl.textContent =
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0');
  }
}

function updateHudUptime() {
  var uptimeEl = document.getElementById('hud-uptime');
  if (uptimeEl) {
    var elapsed = Math.floor((Date.now() - overlayStartTime) / 1000);
    var m = Math.floor(elapsed / 60);
    var s = elapsed % 60;
    uptimeEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
}

function buildTicker() {
  var tickerEl = document.getElementById('ticker');
  if (!tickerEl) return;

  var items = [
    '<span class="brand">ROOMOS</span> \u2014 AI-Powered Room Management',
    'Real-Time <span class="accent">Coaching</span> + Whale Tracking + Silence Detection',
    '<span class="brand">POWERED BY APEX</span>',
    'Smart Goal System \u2014 Auto-Adjusts When Room Is Hot',
    'Session Analytics \u2014 Know Your Peak Hours',
    '<span class="brand">ROOMOS</span> \u2014 Your Room. Smarter. Every Session.',
    'Whale CRM \u2014 Never Forget A Top Tipper',
    '<span class="brand">ROOMOS.IO</span>'
  ];

  var html = '';
  for (var r = 0; r < 3; r++) {
    for (var i = 0; i < items.length; i++) {
      html += '<div class="ticker-item">' + items[i] + '</div>';
      if (i < items.length - 1 || r < 2) {
        html += '<div class="ticker-sep">\u2022</div>';
      }
    }
  }
  tickerEl.innerHTML = html;
}

buildSlides();
buildTicker();
startRotation();
setInterval(updateHudClock, 1000);
setInterval(updateHudUptime, 1000);
