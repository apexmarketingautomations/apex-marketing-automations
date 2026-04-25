// TODO: Move APEX_SECRET and Anthropic/MuAPI calls behind a server proxy in a follow-up task.
import { useState, useRef, useCallback, useEffect, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { Link, useLocation } from "wouter";
import { useActiveSubAccountId } from "@/components/account-required";

const LAYLA_ACCOUNT_ID = 21;

const APEX_URL = "https://apexmarketingautomations.com/webhook/studio";
const APEX_SECRET = "7b5e26c8b3460661fd93259674c95107d6951d0e13eb03a29cdb1a44096bd848";
const MUAPI_BASE = "/api/studio/muapi";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const LAYLA_TRAITS = `Layla is a stunning AI influencer. Mixed Black and White heritage. Warm caramel skin tone. Hazel eyes with golden flecks. Natural curls, sometimes styled or loose. Long lash extensions. Soft glam makeup — never harsh. Approachable yet aspirational. Fashion-forward lifestyle content.`;

const SHOT_TYPES = ["Close-Up", "Portrait", "Half Body", "Full Body", "Environmental", "Wide Shot"];
const ASPECT_RATIOS = ["9:16", "1:1", "16:9", "4:5", "3:4"];
const MOTION_TYPES = ["360 Orbit", "Zoom In", "Zoom Out", "Pan Left", "Pan Right", "Dolly In", "Dolly Out", "Tilt Up", "Tilt Down"];
const VFX_TYPES = ["Film Noir", "VHS Retro", "Cinematic Grade", "Golden Hour", "Neon Glow", "Soft Dreamy", "Vintage Film", "Studio Clean"];

type ModelDef = { id: string; label: string; note: string };

const IMAGE_MODELS: ModelDef[] = [
  { id: "flux-dev-image", label: "Flux Dev", note: "Best quality, slower" },
  { id: "flux-schnell-image", label: "Flux Schnell", note: "Fast, good quality" },
  { id: "flux-2-pro", label: "Flux 2 Pro", note: "Pro tier, crisp" },
  { id: "flux-kontext-max-t2i", label: "Flux Kontext Max", note: "Context-aware" },
  { id: "hidream_i1_full_image", label: "HiDream Full", note: "High detail" },
  { id: "gpt4o-text-to-image", label: "GPT-4o Image", note: "Creative & flexible" },
  { id: "google-imagen4-ultra", label: "Imagen 4 Ultra", note: "Google, photorealistic" },
  { id: "seedream-5.0", label: "Seedream 5.0", note: "Stylized, fast" },
  { id: "hunyuan-image-3.0", label: "Hunyuan 3.0", note: "Chinese aesthetic" },
];

const VIDEO_T2V_MODELS: ModelDef[] = [
  { id: "kling-v2.6-pro-t2v", label: "Kling 2.6 Pro", note: "Best realism, cinematic" },
  { id: "kling-2.1-master-t2v", label: "Kling 2.1 Master", note: "High quality" },
  { id: "wan2.6-text-to-video", label: "WAN 2.6", note: "Scene coherence, fluid motion" },
  { id: "wan2.5-text-to-video", label: "WAN 2.5", note: "Stable, consistent" },
  { id: "seedance-v2.0-t2v", label: "Seedance 2.0", note: "Fast, balanced" },
  { id: "veo3.1-text-to-video", label: "Veo 3.1", note: "Google, cinematic" },
  { id: "hunyuan-text-to-video", label: "Hunyuan T2V", note: "Stylized scenes" },
  { id: "minimax-hailuo-02-pro-t2v", label: "Hailuo 2 Pro", note: "1080p, smooth" },
  { id: "grok-imagine-text-to-video", label: "Grok Imagine", note: "6-30s, ambient audio" },
];

const VIDEO_I2V_MODELS: ModelDef[] = [
  { id: "kling-v2.6-pro-i2v", label: "Kling 2.6 Pro", note: "Best motion, cinematic" },
  { id: "kling-2.1-master-i2v", label: "Kling 2.1 Master", note: "High quality" },
  { id: "kling-2.1-pro-i2v", label: "Kling 2.1 Pro", note: "Great realism" },
  { id: "kling-o1-i2v", label: "Kling O1", note: "Multimodal, dynamic" },
  { id: "wan2.6-image-to-video", label: "WAN 2.6", note: "Depth parallax, atmosphere" },
  { id: "wan2.5-image-to-video", label: "WAN 2.5", note: "Vivid animations" },
  { id: "seedance-v2.0-i2v", label: "Seedance 2.0", note: "Fast, solid" },
  { id: "seedance-2.0-new-omni", label: "Seedance Omni", note: "Multi-reference" },
  { id: "veo3.1-image-to-video", label: "Veo 3.1 I2V", note: "Google quality" },
  { id: "hunyuan-image-to-video", label: "Hunyuan I2V", note: "Smooth motion" },
];

const MOTION_CONTROL_MODELS: ModelDef[] = [
  { id: "kling-v2.6-pro-motion-control", label: "Kling 2.6 Pro Motion", note: "Precise camera control" },
  { id: "kling-2.1-pro-motion-control", label: "Kling 2.1 Motion", note: "Pan, tilt, orbit, dolly" },
];

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=DM+Mono:wght@300;400;500&display=swap');
  .studio-root * { box-sizing: border-box; margin: 0; padding: 0; }
  .studio-root {
    --bg: #080808; --surface: #111111; --surface2: #181818; --surface3: #222222;
    --border: #2a2a2a; --border2: #333333;
    --gold: #c9a96e; --gold2: #e8c98a; --gold-dim: rgba(201,169,110,0.15); --gold-glow: rgba(201,169,110,0.06);
    --text: #f0ede8; --text2: #9a9490; --text3: #5a5550;
    --green: #4caf7d; --green-dim: rgba(76,175,125,0.12);
    --red: #e05555; --red-dim: rgba(224,85,85,0.12);
    --blue: #6b9fd4; --blue-dim: rgba(107,159,212,0.12);
    --radius: 6px; --radius2: 10px;
    background: var(--bg); color: var(--text); font-family: 'DM Mono', monospace; font-size: 12px;
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  }

  .studio-root .login-wrap { display: flex; align-items: center; justify-content: center; height: 100vh; }
  .studio-root .login-card { width: 420px; padding: 48px; border: 1px solid var(--border2); border-radius: var(--radius2); background: var(--surface); }
  .studio-root .login-logo { font-family: 'Cormorant Garamond', serif; font-size: 44px; font-weight: 300; color: var(--gold); letter-spacing: 5px; text-align: center; margin-bottom: 6px; }
  .studio-root .login-sub { text-align: center; color: var(--text3); font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 40px; }
  .studio-root .login-label { display: block; color: var(--text2); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
  .studio-root .login-input { width: 100%; background: var(--surface2); border: 1px solid var(--border2); color: var(--text); font-family: 'DM Mono', monospace; font-size: 12px; padding: 12px 14px; border-radius: var(--radius); outline: none; margin-bottom: 20px; }
  .studio-root .login-input:focus { border-color: var(--gold); }
  .studio-root .login-btn { width: 100%; background: var(--gold); color: #000; font-family: 'DM Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: 2px; text-transform: uppercase; padding: 14px; border: none; border-radius: var(--radius); cursor: pointer; transition: opacity 0.2s; }
  .studio-root .login-btn:hover { opacity: 0.85; }
  .studio-root .login-hint { text-align: center; color: var(--text3); font-size: 10px; margin-top: 16px; }
  .studio-root .login-hint a { color: var(--gold); text-decoration: none; }

  .studio-root .header { display: flex; align-items: center; justify-content: space-between; padding: 0 24px; height: 52px; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--surface); }
  .studio-root .header-logo { font-family: 'Cormorant Garamond', serif; font-size: 22px; font-weight: 400; color: var(--gold); letter-spacing: 3px; }
  .studio-root .header-badge { background: var(--gold-dim); border: 1px solid var(--gold); color: var(--gold); font-size: 9px; letter-spacing: 2px; text-transform: uppercase; padding: 3px 8px; border-radius: 100px; }
  .studio-root .header-right { display: flex; align-items: center; gap: 16px; }
  .studio-root .header-key { color: var(--text3); font-size: 10px; }
  .studio-root .signout-btn { background: none; border: 1px solid var(--border2); color: var(--text3); font-family: 'DM Mono', monospace; font-size: 10px; padding: 5px 10px; border-radius: var(--radius); cursor: pointer; }
  .studio-root .signout-btn:hover { color: var(--text); border-color: var(--text3); }

  .studio-root .tabs-row { display: flex; align-items: center; border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0; padding: 0 16px; gap: 2px; overflow-x: auto; }
  .studio-root .tabs-row::-webkit-scrollbar { display: none; }
  .studio-root .tab-btn { background: none; border: none; color: var(--text3); font-family: 'DM Mono', monospace; font-size: 11px; padding: 14px 16px; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; white-space: nowrap; }
  .studio-root .tab-btn:hover { color: var(--text2); }
  .studio-root .tab-btn.active { color: var(--gold); border-bottom-color: var(--gold); }

  .studio-root .main { display: flex; flex: 1; overflow: hidden; }
  .studio-root .panel { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  .studio-root .panel::-webkit-scrollbar { width: 4px; }
  .studio-root .panel::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .studio-root .sidebar { width: 280px; border-left: 1px solid var(--border); overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; background: var(--surface); }
  .studio-root .sidebar::-webkit-scrollbar { width: 3px; }
  .studio-root .sidebar::-webkit-scrollbar-thumb { background: var(--border2); }
  .studio-root .sidebar-title { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: var(--text3); padding-bottom: 8px; border-bottom: 1px solid var(--border); }

  .studio-root .card { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius2); padding: 16px; }
  .studio-root .card-title { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--text2); margin-bottom: 14px; }
  .studio-root .section-label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text3); margin-bottom: 6px; display: block; }

  .studio-root input[type="text"], .studio-root input[type="number"], .studio-root textarea, .studio-root select {
    background: var(--surface3); border: 1px solid var(--border); color: var(--text);
    font-family: 'DM Mono', monospace; font-size: 12px; padding: 10px 12px;
    border-radius: var(--radius); outline: none; width: 100%; transition: border-color 0.15s;
  }
  .studio-root input:focus, .studio-root textarea:focus, .studio-root select:focus { border-color: var(--gold); }
  .studio-root textarea { resize: vertical; min-height: 80px; line-height: 1.6; }
  .studio-root select option { background: var(--surface3); }
  .studio-root .row { display: flex; gap: 10px; }
  .studio-root .row > * { flex: 1; }
  .studio-root .col { display: flex; flex-direction: column; gap: 6px; }

  .studio-root .btn { font-family: 'DM Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase; padding: 11px 20px; border-radius: var(--radius); cursor: pointer; border: none; transition: all 0.15s; white-space: nowrap; }
  .studio-root .btn-gold { background: var(--gold); color: #000; }
  .studio-root .btn-gold:hover { background: var(--gold2); }
  .studio-root .btn-ghost { background: transparent; border: 1px solid var(--border2); color: var(--text2); }
  .studio-root .btn-ghost:hover { border-color: var(--text2); color: var(--text); }
  .studio-root .btn-green { background: var(--green); color: #000; }
  .studio-root .btn-green:hover { opacity: 0.85; }
  .studio-root .btn-blue { background: var(--blue-dim); border: 1px solid var(--blue); color: var(--blue); }
  .studio-root .btn-sm { padding: 7px 14px; font-size: 10px; }
  .studio-root .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .studio-root .btn-full { width: 100%; }

  .studio-root .model-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 14px; }
  .studio-root .model-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 9px 12px; cursor: pointer; transition: all 0.15s; background: var(--surface3); }
  .studio-root .model-card:hover { border-color: var(--border2); }
  .studio-root .model-card.selected { border-color: var(--gold); background: var(--gold-glow); }
  .studio-root .model-card-label { font-size: 11px; color: var(--text); margin-bottom: 2px; }
  .studio-root .model-card-note { font-size: 9px; color: var(--text3); }
  .studio-root .model-card.selected .model-card-label { color: var(--gold); }

  .studio-root .status-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .studio-root .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .studio-root .dot-gold { background: var(--gold); animation: laylaPulse 1.5s infinite; }
  .studio-root .dot-green { background: var(--green); }
  .studio-root .dot-red { background: var(--red); }
  @keyframes laylaPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  .studio-root .asset-preview { border-radius: var(--radius2); overflow: hidden; background: var(--surface3); border: 1px solid var(--border); }
  .studio-root .asset-preview img, .studio-root .asset-preview video { width: 100%; display: block; max-height: 440px; object-fit: contain; }
  .studio-root .asset-actions { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--border); flex-wrap: wrap; align-items: center; }
  .studio-root .face-badge { background: var(--gold-dim); border: 1px solid var(--gold); color: var(--gold); font-size: 9px; letter-spacing: 1.5px; padding: 3px 8px; border-radius: 100px; }
  .studio-root .model-tag { background: var(--surface3); border: 1px solid var(--border); color: var(--text3); font-size: 9px; padding: 2px 7px; border-radius: 100px; }

  .studio-root .face-thumb { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid var(--gold); flex-shrink: 0; }
  .studio-root .face-placeholder { width: 56px; height: 56px; border-radius: 50%; background: var(--surface3); border: 2px dashed var(--border2); display: flex; align-items: center; justify-content: center; color: var(--text3); font-size: 20px; flex-shrink: 0; }

  .studio-root .upload-zone { border: 2px dashed var(--border2); border-radius: var(--radius2); padding: 20px; text-align: center; cursor: pointer; transition: all 0.2s; }
  .studio-root .upload-zone:hover, .studio-root .upload-zone.drag-over { border-color: var(--gold); background: var(--gold-glow); }
  .studio-root .upload-icon { font-size: 24px; margin-bottom: 6px; }
  .studio-root .upload-text { color: var(--text2); font-size: 11px; }
  .studio-root .upload-sub { color: var(--text3); font-size: 10px; margin-top: 3px; }

  .studio-root .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .studio-root .modal { width: 500px; background: var(--surface); border: 1px solid var(--border2); border-radius: var(--radius2); padding: 28px; max-height: 90vh; overflow-y: auto; }
  .studio-root .modal-title { font-family: 'Cormorant Garamond', serif; font-size: 22px; color: var(--gold); margin-bottom: 20px; }
  .studio-root .platform-row { display: flex; gap: 8px; margin-bottom: 20px; }
  .studio-root .platform-btn { flex: 1; padding: 10px; border-radius: var(--radius); border: 1px solid var(--border2); background: transparent; color: var(--text2); font-family: 'DM Mono', monospace; font-size: 11px; cursor: pointer; transition: all 0.15s; }
  .studio-root .platform-btn.selected { border-color: var(--gold); color: var(--gold); background: var(--gold-dim); }
  .studio-root .caption-area { width: 100%; min-height: 120px; margin-bottom: 6px; }
  .studio-root .char-count { font-size: 10px; color: var(--text3); text-align: right; margin-bottom: 16px; }
  .studio-root .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }

  .studio-root .lib-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .studio-root .lib-item { border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border); cursor: pointer; position: relative; aspect-ratio: 9/16; background: var(--surface3); }
  .studio-root .lib-item img, .studio-root .lib-item video { width: 100%; height: 100%; object-fit: cover; }
  .studio-root .lib-item:hover .lib-overlay { opacity: 1; }
  .studio-root .lib-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.6); opacity: 0; transition: opacity 0.2s; display: flex; align-items: center; justify-content: center; }
  .studio-root .lib-type { position: absolute; top: 5px; left: 5px; background: rgba(0,0,0,0.75); color: var(--text2); font-size: 8px; padding: 2px 5px; border-radius: 3px; letter-spacing: 1px; }

  .studio-root .progress-bar { height: 3px; background: var(--surface3); border-radius: 2px; overflow: hidden; margin-top: 10px; }
  .studio-root .progress-fill { height: 100%; background: var(--gold); border-radius: 2px; transition: width 0.4s; }
  .studio-root .trait-chip { display: inline-block; background: var(--gold-dim); border: 1px solid var(--gold); color: var(--gold); font-size: 10px; padding: 3px 10px; border-radius: 100px; margin: 2px; }
  .studio-root .divider { height: 1px; background: var(--border); margin: 8px 0; }
  .studio-root .error-box { background: var(--red-dim); border: 1px solid var(--red); color: var(--red); border-radius: var(--radius); padding: 10px 14px; font-size: 11px; line-height: 1.6; }
  .studio-root .success-box { background: var(--green-dim); border: 1px solid var(--green); color: var(--green); border-radius: var(--radius); padding: 10px 14px; font-size: 11px; }
  .studio-root .thumb-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .studio-root .thumb-img { width: 60px; height: 80px; object-fit: cover; border-radius: 5px; cursor: pointer; border: 2px solid var(--border); transition: border-color 0.15s; }
  .studio-root .thumb-img.selected { border-color: var(--gold); }
  .studio-root .thumb-vid { width: 60px; height: 80px; object-fit: cover; border-radius: 5px; cursor: pointer; border: 2px solid var(--border); transition: border-color 0.15s; }
  .studio-root .thumb-vid.selected { border-color: var(--gold); }
`;

type Asset = {
  type: "image" | "video";
  url: string;
  prompt?: string;
  shotType?: string;
  aspectRatio?: string;
  faceSwapped?: boolean;
  model?: string;
};

type FaceRef = { url: string; preview: string } | null;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type MuapiResult = {
  status?: string;
  error?: string;
  prediction_id?: string;
  output?: JsonValue;
  url?: string;
  urls?: { get?: string };
  [key: string]: JsonValue | undefined;
};

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unknown error";
}

async function muapiPost(endpoint: string, body: JsonObject, apiKey: string): Promise<MuapiResult> {
  const res = await fetch(`${MUAPI_BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-muapi-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`muapi ${endpoint}: ${res.status} — ${await res.text()}`);
  return res.json() as Promise<MuapiResult>;
}

async function pollResult(predictionId: string, apiKey: string, onProgress?: (n: number) => void, maxAttempts = 150): Promise<MuapiResult> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(`${MUAPI_BASE}/predictions/${predictionId}/result`, { headers: { "x-muapi-key": apiKey } });
    const data = (await res.json()) as MuapiResult;
    if (data.status === "succeeded") return data;
    if (data.status === "failed") throw new Error(data.error || "Generation failed");
    onProgress?.(Math.min(88, (i / maxAttempts) * 100));
  }
  throw new Error("Timed out waiting for result");
}

async function uploadFile(file: File, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${MUAPI_BASE}/upload_file`, { method: "POST", headers: { "x-muapi-key": apiKey }, body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  return data.url || data.file_url;
}

function extractUrl(result: MuapiResult | null | undefined): string | null {
  if (!result) return null;
  const output = result.output;
  if (output && typeof output === "object" && !Array.isArray(output) && typeof (output as JsonObject).url === "string") {
    return (output as JsonObject).url as string;
  }
  if (Array.isArray(output) && output[0] && typeof output[0] === "object" && typeof (output[0] as JsonObject).url === "string") {
    return (output[0] as JsonObject).url as string;
  }
  if (typeof output === "string") return output;
  if (result.urls?.get) return result.urls.get;
  if (typeof result.url === "string") return result.url;
  return null;
}

async function claudeCaption(prompt: string, platform: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 1000,
      messages: [{ role: "user", content: `Write an engaging ${platform} caption for AI influencer Layla's post. Content: "${prompt}". Write a captivating caption with relevant emojis, a soft CTA mentioning her Telegram (t.me/LaylasLifeee), and 10–15 relevant hashtags. Warm, aspirational, on-brand. Return ONLY the caption text.` }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function claudePrompt(scene: string, extras: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 400,
      messages: [{ role: "user", content: `Write a vivid, detailed image generation prompt for Layla, an AI influencer. Character: ${LAYLA_TRAITS}. Scene: "${scene}". ${extras ? `Details: ${extras}` : ""}. Focus on lighting, mood, outfit, setting. Return ONLY the prompt.` }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function sendToApex(payload: JsonObject): Promise<JsonObject> {
  const res = await fetch(APEX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": APEX_SECRET },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Apex: ${res.status}`);
  return res.json();
}

function ProgressBar({ value }: { value: number }) {
  return <div className="progress-bar"><div className="progress-fill" style={{ width: `${value}%` }} /></div>;
}

function UploadZone({ onFile, accept = "image/*", label = "Drop or click to upload" }: { onFile: (file: File) => void; accept?: string; label?: string }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div className={`upload-zone${drag ? " drag-over" : ""}`}
      onClick={() => ref.current?.click()}
      onDragOver={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      data-testid="upload-zone">
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }} />
      <div className="upload-icon">↑</div>
      <div className="upload-text">{label}</div>
      <div className="upload-sub">JPG · PNG · MP4 · MOV · MP3</div>
    </div>
  );
}

function ModelPicker({ models, selected, onSelect }: { models: ModelDef[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="model-grid">
      {models.map(m => (
        <div key={m.id} className={`model-card${selected === m.id ? " selected" : ""}`} onClick={() => onSelect(m.id)} data-testid={`model-${m.id}`}>
          <div className="model-card-label">{m.label}</div>
          <div className="model-card-note">{m.note}</div>
        </div>
      ))}
    </div>
  );
}

function GeneratingStatus({ status, progress }: { status: string; progress: number }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="status-row"><div className="dot dot-gold" /><span style={{ color: "var(--gold)" }}>{status}</span></div>
      <ProgressBar value={progress} />
    </div>
  );
}

function AssetCard({ asset, onSendToApex }: { asset: Asset; onSendToApex: (a: Asset) => void }) {
  const isVideo = asset.type === "video";
  return (
    <div className="asset-preview">
      {isVideo ? <video src={asset.url} controls playsInline /> : <img src={asset.url} alt="Generated" />}
      <div className="asset-actions">
        {asset.faceSwapped && <span className="face-badge">✦ FACE LOCKED</span>}
        {asset.model && <span className="model-tag">{asset.model}</span>}
        <div style={{ flex: 1 }} />
        <a href={asset.url} download target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }}>↓ Save</a>
        <button className="btn btn-green btn-sm" onClick={() => onSendToApex(asset)} data-testid="button-send-apex">⬆ Apex</button>
      </div>
    </div>
  );
}

function ApexModal({ asset, onClose, onSuccess }: { asset: Asset; onClose: () => void; onSuccess?: () => void }) {
  const [platform, setPlatform] = useState("Instagram");
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function genCaption() {
    setLoading(true);
    try { setCaption(await claudeCaption(asset.prompt || "", platform)); }
    catch (e: unknown) { setError(errorMessage(e)); }
    setLoading(false);
  }

  async function publish() {
    setSending(true); setError("");
    try {
      await sendToApex({
        type: asset.type, url: asset.url, character: "Layla", prompt: asset.prompt,
        shot_type: asset.shotType || "Portrait", aspect_ratio: asset.aspectRatio || "9:16",
        face_swapped: !!asset.faceSwapped, generated_at: new Date().toISOString(),
        suggested_caption: caption, platform,
        tags: ["fashion", "lifestyle", "layla", "instagram", "aiinfluencer"],
      });
      onSuccess?.();
      onClose();
    } catch (e: unknown) { setError(errorMessage(e)); }
    setSending(false);
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">⬆ Send to Apex</div>
        <span className="section-label">Platform</span>
        <div className="platform-row">
          {["Instagram", "Facebook", "Both"].map(p => (
            <button key={p} className={`platform-btn${platform === p ? " selected" : ""}`} onClick={() => setPlatform(p)} data-testid={`platform-${p}`}>{p}</button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span className="section-label">Caption</span>
          <button className="btn btn-ghost btn-sm" onClick={genCaption} disabled={loading} data-testid="button-gen-caption">{loading ? "Writing..." : "✦ AI Generate"}</button>
        </div>
        <textarea className="caption-area" value={caption} onChange={e => setCaption(e.target.value)} placeholder="Write or generate a caption..." data-testid="textarea-caption" />
        <div className="char-count">{caption.length} chars</div>
        {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} data-testid="button-cancel-apex">Cancel</button>
          <button className="btn btn-green" onClick={publish} disabled={sending || !caption} data-testid="button-publish-apex">{sending ? "Publishing..." : "Publish →"}</button>
        </div>
      </div>
    </div>
  );
}

function TabLayla({ laylaFace, setLaylaFace, laylaPrompt, setLaylaPrompt, apiKey }: { laylaFace: FaceRef; setLaylaFace: (f: FaceRef) => void; laylaPrompt: string; setLaylaPrompt: (s: string) => void; apiKey: string }) {
  const [scene, setScene] = useState("");
  const [extras, setExtras] = useState("");
  const [building, setBuilding] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function buildPrompt() {
    setBuilding(true);
    try { setLaylaPrompt(await claudePrompt(scene, extras)); }
    catch (e) { console.error(e); }
    setBuilding(false);
  }

  async function uploadFace(file: File) {
    setUploading(true);
    try {
      const url = await uploadFile(file, apiKey);
      setLaylaFace({ url, preview: URL.createObjectURL(file) });
    } catch (e) { console.error(e); }
    setUploading(false);
  }

  return (
    <div style={{ display: "flex", gap: 20 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card">
          <div className="card-title">✦ Face Reference</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {laylaFace ? <img className="face-thumb" src={laylaFace.preview} alt="Layla" /> : <div className="face-placeholder">✦</div>}
            <div style={{ flex: 1 }}>
              <UploadZone onFile={uploadFace} accept="image/*" label={uploading ? "Uploading..." : laylaFace ? "Replace face reference" : "Upload Layla's best front-facing photo"} />
            </div>
          </div>
          {laylaFace && <div className="success-box" style={{ marginTop: 12 }}>✓ Face locked — auto-applies to all generations</div>}
        </div>

        <div className="card">
          <div className="card-title">✦ AI Prompt Builder</div>
          <div className="col" style={{ marginBottom: 10 }}>
            <span className="section-label">Scene / Setting</span>
            <input type="text" value={scene} onChange={e => setScene(e.target.value)} placeholder="e.g. rooftop pool in Dubai at golden hour" data-testid="input-scene" />
          </div>
          <div className="col" style={{ marginBottom: 12 }}>
            <span className="section-label">Details</span>
            <input type="text" value={extras} onChange={e => setExtras(e.target.value)} placeholder="e.g. white bikini, oversized sun hat, champagne" data-testid="input-extras" />
          </div>
          <button className="btn btn-gold" onClick={buildPrompt} disabled={building || !scene} data-testid="button-build-prompt">{building ? "Writing..." : "✦ Build with Claude"}</button>
        </div>

        <div className="card">
          <div className="card-title">Master Prompt</div>
          <textarea value={laylaPrompt} onChange={e => setLaylaPrompt(e.target.value)} style={{ minHeight: 140 }} placeholder="AI-built prompt appears here — or write your own..." data-testid="textarea-master-prompt" />
        </div>

        <div className="card">
          <div className="card-title">Character Traits</div>
          <div style={{ marginBottom: 10 }}>
            {["Mixed Black & White", "Caramel Skin", "Hazel Eyes", "Natural Curls", "Lash Extensions", "Soft Glam", "Fashion Forward", "Aspirational"].map(t => (
              <span key={t} className="trait-chip">{t}</span>
            ))}
          </div>
          <div style={{ color: "var(--text3)", fontSize: 11, lineHeight: 1.7 }}>{LAYLA_TRAITS}</div>
        </div>
      </div>

      <div style={{ width: 240, flexShrink: 0 }}>
        <div className="card">
          <div className="card-title">Pipeline Status</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="status-row">
              <div className={`dot ${laylaFace ? "dot-green" : "dot-red"}`} />
              <span style={{ color: laylaFace ? "var(--green)" : "var(--red)" }}>Face {laylaFace ? "Locked ✓" : "Not Set"}</span>
            </div>
            <div className="status-row">
              <div className={`dot ${laylaPrompt ? "dot-green" : "dot-red"}`} />
              <span style={{ color: laylaPrompt ? "var(--green)" : "var(--red)" }}>Prompt {laylaPrompt ? "Ready ✓" : "Empty"}</span>
            </div>
            <div className="divider" />
            <div style={{ color: "var(--text3)", fontSize: 10, lineHeight: 1.8 }}>
              Set face + prompt here first. Face auto-swaps onto every generation across all tabs.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabImages({ laylaFace, laylaPrompt, apiKey, addToLibrary }: { laylaFace: FaceRef; laylaPrompt: string; apiKey: string; addToLibrary: (a: Asset) => void }) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("flux-dev-image");
  const [shotType, setShotType] = useState("Portrait");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const [apexAsset, setApexAsset] = useState<Asset | null>(null);

  useEffect(() => { if (laylaPrompt) setPrompt(laylaPrompt); }, [laylaPrompt]);

  async function generate() {
    setGenerating(true); setError(""); setProgress(0);
    try {
      setStatus("Generating image...");
      const gen = await muapiPost(model, { prompt: `${prompt}, ${shotType.toLowerCase()} shot`, aspect_ratio: aspectRatio }, apiKey);
      setProgress(30);
      const result = await pollResult(gen.id, apiKey, setProgress);
      let imageUrl = extractUrl(result);
      const modelLabel = IMAGE_MODELS.find(m => m.id === model)?.label || model;

      if (laylaFace?.url && imageUrl) {
        setStatus("Locking face...");
        setProgress(65);
        const swap = await muapiPost("ai-image-face-swap", { target_image: imageUrl, source_image: laylaFace.url }, apiKey);
        const swapResult = await pollResult(swap.id, apiKey, p => setProgress(65 + p * 0.35));
        imageUrl = extractUrl(swapResult) || imageUrl;
      }

      const asset: Asset = { type: "image", url: imageUrl || "", prompt, shotType, aspectRatio, faceSwapped: !!laylaFace, model: modelLabel };
      setResults(r => [asset, ...r]);
      addToLibrary(asset);
      setStatus("Done ✓"); setProgress(100);
    } catch (e: unknown) { setError(errorMessage(e)); setStatus(""); }
    setGenerating(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-title">Generate Image</div>
        <span className="section-label">Model</span>
        <ModelPicker models={IMAGE_MODELS} selected={model} onSelect={setModel} />
        <div className="col" style={{ marginBottom: 10 }}>
          <span className="section-label">Prompt</span>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe the scene..." data-testid="textarea-image-prompt" />
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="col">
            <span className="section-label">Shot Type</span>
            <select value={shotType} onChange={e => setShotType(e.target.value)} data-testid="select-shot-type">
              {SHOT_TYPES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="col">
            <span className="section-label">Ratio</span>
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} data-testid="select-aspect-ratio">
              {ASPECT_RATIOS.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>
        {laylaFace && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <img src={laylaFace.preview} style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid var(--gold)", objectFit: "cover" }} />
            <span style={{ color: "var(--gold)", fontSize: 10 }}>Face reference will auto-apply</span>
          </div>
        )}
        <button className="btn btn-gold btn-full" onClick={generate} disabled={generating || !prompt} data-testid="button-generate-image">{generating ? "Generating..." : "✦ Generate"}</button>
        {generating && <GeneratingStatus status={status} progress={progress} />}
        {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      </div>
      {results.map((asset, i) => <AssetCard key={i} asset={asset} onSendToApex={setApexAsset} />)}
      {apexAsset && <ApexModal asset={apexAsset} onClose={() => setApexAsset(null)} />}
    </div>
  );
}

function TabVideo({ laylaFace, laylaPrompt, apiKey, library, addToLibrary }: { laylaFace: FaceRef; laylaPrompt: string; apiKey: string; library: Asset[]; addToLibrary: (a: Asset) => void }) {
  const [mode, setMode] = useState<"t2v" | "i2v">("t2v");
  const [prompt, setPrompt] = useState("");
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);
  const [modelT2V, setModelT2V] = useState("kling-v2.6-pro-t2v");
  const [modelI2V, setModelI2V] = useState("kling-v2.6-pro-i2v");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [duration, setDuration] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const [apexAsset, setApexAsset] = useState<Asset | null>(null);

  useEffect(() => { if (laylaPrompt) setPrompt(laylaPrompt); }, [laylaPrompt]);
  const images = library.filter(a => a.type === "image");

  async function generate() {
    setGenerating(true); setError(""); setProgress(0);
    try {
      let videoUrl: string | null = null;
      const selectedModel = mode === "t2v" ? modelT2V : modelI2V;
      const modelLabel = (mode === "t2v" ? VIDEO_T2V_MODELS : VIDEO_I2V_MODELS).find(m => m.id === selectedModel)?.label || selectedModel;

      if (mode === "t2v") {
        setStatus("Generating video...");
        const gen = await muapiPost(selectedModel, { prompt, aspect_ratio: aspectRatio, duration }, apiKey);
        const result = await pollResult(gen.id, apiKey, p => setProgress(p * 0.75));
        videoUrl = extractUrl(result);
      } else {
        if (!sourceAsset) { setError("Select a source image first"); setGenerating(false); return; }
        setStatus("Animating image...");
        const gen = await muapiPost(selectedModel, { prompt, image_url: sourceAsset.url, aspect_ratio: aspectRatio, duration }, apiKey);
        const result = await pollResult(gen.id, apiKey, p => setProgress(p * 0.75));
        videoUrl = extractUrl(result);
      }

      if (laylaFace?.url && videoUrl) {
        setStatus("Locking face..."); setProgress(78);
        const swap = await muapiPost("ai-video-face-swap", { target_video: videoUrl, source_image: laylaFace.url }, apiKey);
        const swapResult = await pollResult(swap.id, apiKey, p => setProgress(78 + p * 0.22));
        videoUrl = extractUrl(swapResult) || videoUrl;
      }

      const asset: Asset = { type: "video", url: videoUrl || "", prompt, aspectRatio, faceSwapped: !!laylaFace, model: modelLabel };
      setResults(r => [asset, ...r]);
      addToLibrary(asset);
      setStatus("Done ✓"); setProgress(100);
    } catch (e: unknown) { setError(errorMessage(e)); setStatus(""); }
    setGenerating(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-title">Generate Video</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["t2v", "i2v"] as const).map(m => (
            <button key={m} className={`platform-btn${mode === m ? " selected" : ""}`} onClick={() => setMode(m)} data-testid={`mode-${m}`}>
              {m === "t2v" ? "Text → Video" : "Image → Video"}
            </button>
          ))}
        </div>

        {mode === "t2v" ? (
          <>
            <span className="section-label">Model</span>
            <ModelPicker models={VIDEO_T2V_MODELS} selected={modelT2V} onSelect={setModelT2V} />
          </>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <span className="section-label">Source Image</span>
              {images.length === 0
                ? <div style={{ color: "var(--text3)", fontSize: 11 }}>Generate images first in the Images tab</div>
                : <div className="thumb-row">
                    {images.map((img, i) => (
                      <img key={i} src={img.url} className={`thumb-img${sourceAsset === img ? " selected" : ""}`} alt="" onClick={() => setSourceAsset(img)} />
                    ))}
                  </div>
              }
            </div>
            <span className="section-label">Model</span>
            <ModelPicker models={VIDEO_I2V_MODELS} selected={modelI2V} onSelect={setModelI2V} />
          </>
        )}

        <div className="col" style={{ marginBottom: 10 }}>
          <span className="section-label">Prompt</span>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe motion, camera, scene..." data-testid="textarea-video-prompt" />
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="col">
            <span className="section-label">Ratio</span>
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} data-testid="select-video-ratio">
              {ASPECT_RATIOS.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div className="col">
            <span className="section-label">Duration (s)</span>
            <select value={duration} onChange={e => setDuration(Number(e.target.value))} data-testid="select-duration">
              {[4, 5, 6, 8, 10].map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-gold btn-full" onClick={generate} disabled={generating || !prompt} data-testid="button-generate-video">{generating ? "Generating..." : "✦ Generate Video"}</button>
        {generating && <GeneratingStatus status={status} progress={progress} />}
        {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      </div>
      {results.map((asset, i) => <AssetCard key={i} asset={asset} onSendToApex={setApexAsset} />)}
      {apexAsset && <ApexModal asset={apexAsset} onClose={() => setApexAsset(null)} />}
    </div>
  );
}

function TabCinema({ apiKey, library, addToLibrary }: { apiKey: string; library: Asset[]; addToLibrary: (a: Asset) => void }) {
  const [mode, setMode] = useState<"motion" | "vfx">("motion");
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);
  const [motionModel, setMotionModel] = useState("kling-v2.6-pro-motion-control");
  const [motion, setMotion] = useState("360 Orbit");
  const [vfx, setVfx] = useState("Film Noir");
  const [prompt, setPrompt] = useState("");
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const [apexAsset, setApexAsset] = useState<Asset | null>(null);

  const images = library.filter(a => a.type === "image");

  async function apply() {
    if (!sourceAsset) { setError("Select a source image"); return; }
    setProcessing(true); setError(""); setProgress(0);
    const effect = mode === "motion" ? motion : vfx;
    try {
      setStatus(`Applying ${effect}...`);
      let gen: MuapiResult;
      if (mode === "motion") {
        gen = await muapiPost(motionModel, { image_url: sourceAsset.url, motion_type: motion, prompt }, apiKey);
      } else {
        gen = await muapiPost("generate_wan_ai_effects", { image_url: sourceAsset.url, effect, prompt }, apiKey);
      }
      const result = await pollResult(String(gen.prediction_id ?? gen.id ?? ""), apiKey, setProgress);
      const url = extractUrl(result);
      const asset: Asset = { type: "video", url: url || "", prompt: `${effect} — ${prompt}`, faceSwapped: false, model: effect };
      setResults(r => [asset, ...r]);
      addToLibrary(asset);
      setStatus("Done ✓"); setProgress(100);
    } catch (e: unknown) { setError(errorMessage(e)); setStatus(""); }
    setProcessing(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-title">Cinema FX</div>
        <div style={{ marginBottom: 14 }}>
          <span className="section-label">Source Image</span>
          {images.length === 0
            ? <div style={{ color: "var(--text3)", fontSize: 11 }}>Generate images first</div>
            : <div className="thumb-row">
                {images.map((img, i) => <img key={i} src={img.url} className={`thumb-img${sourceAsset === img ? " selected" : ""}`} alt="" onClick={() => setSourceAsset(img)} />)}
              </div>
          }
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {(["motion", "vfx"] as const).map(m => (
            <button key={m} className={`platform-btn${mode === m ? " selected" : ""}`} onClick={() => setMode(m)} data-testid={`cinema-mode-${m}`}>
              {m === "motion" ? "Motion Control" : "AI VFX"}
            </button>
          ))}
        </div>

        {mode === "motion" ? (
          <>
            <div style={{ marginBottom: 10 }}>
              <span className="section-label">Motion Engine</span>
              <ModelPicker models={MOTION_CONTROL_MODELS} selected={motionModel} onSelect={setMotionModel} />
            </div>
            <span className="section-label">Camera Move</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {MOTION_TYPES.map(m => (
                <button key={m} className={`platform-btn${motion === m ? " selected" : ""}`} style={{ flex: "none", padding: "7px 12px", fontSize: 10 }} onClick={() => setMotion(m)}>{m}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <span className="section-label">VFX Style</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {VFX_TYPES.map(v => (
                <button key={v} className={`platform-btn${vfx === v ? " selected" : ""}`} style={{ flex: "none", padding: "7px 12px", fontSize: 10 }} onClick={() => setVfx(v)}>{v}</button>
              ))}
            </div>
          </>
        )}

        <div className="col" style={{ marginBottom: 12 }}>
          <span className="section-label">Additional Prompt</span>
          <input type="text" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. slow motion, dramatic lighting, sunset..." data-testid="input-cinema-prompt" />
        </div>
        <button className="btn btn-gold btn-full" onClick={apply} disabled={processing || !sourceAsset} data-testid="button-apply-cinema">{processing ? "Rendering..." : "✦ Apply"}</button>
        {processing && <GeneratingStatus status={status} progress={progress} />}
        {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      </div>
      {results.map((asset, i) => <AssetCard key={i} asset={asset} onSendToApex={setApexAsset} />)}
      {apexAsset && <ApexModal asset={apexAsset} onClose={() => setApexAsset(null)} />}
    </div>
  );
}

function TabLipsync({ apiKey, library, addToLibrary }: { apiKey: string; library: Asset[]; addToLibrary: (a: Asset) => void }) {
  const [videoAsset, setVideoAsset] = useState<Asset | null>(null);
  const [audioMode, setAudioMode] = useState<"generate" | "upload">("generate");
  const [audioPrompt, setAudioPrompt] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [provider, setProvider] = useState("veed-lipsync");
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const [apexAsset, setApexAsset] = useState<Asset | null>(null);

  const videos = library.filter(a => a.type === "video");

  async function generateAudio() {
    setProcessing(true); setError(""); setStatus("Generating audio...");
    try {
      const gen = await muapiPost("mmaudio-v2/text-to-audio", { prompt: audioPrompt, duration: 10 }, apiKey);
      const result = await pollResult(gen.id, apiKey, setProgress);
      setAudioUrl(extractUrl(result) || ""); setStatus("Audio ready ✓");
    } catch (e: unknown) { setError(errorMessage(e)); }
    setProcessing(false);
  }

  async function uploadAudio(file: File) {
    setProcessing(true); setStatus("Uploading...");
    try { setAudioUrl(await uploadFile(file, apiKey)); setStatus("Audio ready ✓"); }
    catch (e: unknown) { setError(errorMessage(e)); }
    setProcessing(false);
  }

  async function applyLipsync() {
    if (!videoAsset || !audioUrl) { setError("Need video and audio"); return; }
    setProcessing(true); setError(""); setProgress(0); setStatus("Applying lipsync...");
    try {
      const gen = await muapiPost(provider, { video_url: videoAsset.url, audio_url: audioUrl }, apiKey);
      const result = await pollResult(gen.id, apiKey, setProgress);
      const url = extractUrl(result);
      const asset: Asset = { type: "video", url: url || "", prompt: audioPrompt || "Lipsync", faceSwapped: videoAsset.faceSwapped, model: provider };
      setResults(r => [asset, ...r]);
      addToLibrary(asset);
      setStatus("Done ✓"); setProgress(100);
    } catch (e: unknown) { setError(errorMessage(e)); setStatus(""); }
    setProcessing(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-title">Lipsync</div>
        <div style={{ marginBottom: 14 }}>
          <span className="section-label">1. Source Video</span>
          {videos.length === 0
            ? <div style={{ color: "var(--text3)", fontSize: 11 }}>Generate video first in Video or Cinema tab</div>
            : <div className="thumb-row">
                {videos.map((v, i) => <video key={i} src={v.url} className={`thumb-vid${videoAsset === v ? " selected" : ""}`} onClick={() => setVideoAsset(v)} muted />)}
              </div>
          }
        </div>
        <div className="divider" style={{ margin: "14px 0" }} />
        <span className="section-label">2. Audio</span>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(["generate", "upload"] as const).map(m => (
            <button key={m} className={`platform-btn${audioMode === m ? " selected" : ""}`} onClick={() => setAudioMode(m)} data-testid={`audio-mode-${m}`}>
              {m === "generate" ? "Generate" : "Upload"}
            </button>
          ))}
        </div>
        {audioMode === "generate" ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input type="text" value={audioPrompt} onChange={e => setAudioPrompt(e.target.value)} placeholder='e.g. "Layla talking about her morning routine..."' style={{ flex: 1 }} data-testid="input-audio-prompt" />
            <button className="btn btn-ghost btn-sm" onClick={generateAudio} disabled={processing || !audioPrompt} data-testid="button-generate-audio">Generate</button>
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <UploadZone onFile={uploadAudio} accept="audio/*" label="Upload audio file" />
          </div>
        )}
        {audioUrl && <div className="success-box" style={{ marginBottom: 12 }}>✓ Audio ready</div>}
        <div className="divider" style={{ margin: "14px 0" }} />
        <div style={{ marginBottom: 12 }}>
          <span className="section-label">3. Provider</span>
          <select value={provider} onChange={e => setProvider(e.target.value)} data-testid="select-provider">
            <option value="veed-lipsync">VEED (Recommended)</option>
            <option value="sync-lipsync">Sync</option>
            <option value="creatify-lipsync">Creatify</option>
            <option value="ltx-2-19b-lipsync">LTX 2 19B</option>
            <option value="latentsync-lipsync">LatentSync</option>
          </select>
        </div>
        <button className="btn btn-gold btn-full" onClick={applyLipsync} disabled={processing || !videoAsset || !audioUrl} data-testid="button-apply-lipsync">{processing && status.includes("lipsync") ? "Processing..." : "✦ Apply Lipsync"}</button>
        {processing && <GeneratingStatus status={status} progress={progress} />}
        {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      </div>
      {results.map((asset, i) => <AssetCard key={i} asset={asset} onSendToApex={setApexAsset} />)}
      {apexAsset && <ApexModal asset={apexAsset} onClose={() => setApexAsset(null)} />}
    </div>
  );
}

function TabPostFX({ apiKey, library, addToLibrary }: { apiKey: string; library: Asset[]; addToLibrary: (a: Asset) => void }) {
  const [sourceAsset, setSourceAsset] = useState<Asset | null>(null);
  const [fx, setFx] = useState("upscale");
  const [dressPrompt, setDressPrompt] = useState("");
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Asset[]>([]);
  const [error, setError] = useState("");
  const [apexAsset, setApexAsset] = useState<Asset | null>(null);

  const images = library.filter(a => a.type === "image");
  const FX_OPTIONS = [
    { id: "upscale", label: "Upscale 4K", endpoint: "ai-image-upscale" },
    { id: "topaz", label: "Topaz Upscale", endpoint: "topaz-image-upscale" },
    { id: "bg", label: "Remove BG", endpoint: "ai-background-remover" },
    { id: "skin", label: "Skin Enhance", endpoint: "ai-skin-enhancer" },
    { id: "dress", label: "Dress Change", endpoint: "ai-dress-change" },
    { id: "ghibli", label: "Ghibli Style", endpoint: "ai-ghibli-style" },
    { id: "color", label: "Colorize", endpoint: "ai-color-photo" },
  ];
  const currentFX = FX_OPTIONS.find(o => o.id === fx)!;

  async function applyFX() {
    if (!sourceAsset) { setError("Select an image"); return; }
    setProcessing(true); setError(""); setProgress(0); setStatus(`Applying ${currentFX.label}...`);
    try {
      const body: JsonObject = { image_url: sourceAsset.url };
      if (fx === "dress") body.prompt = dressPrompt;
      const gen = await muapiPost(currentFX.endpoint, body, apiKey);
      const result = await pollResult(String(gen.prediction_id ?? gen.id ?? ""), apiKey, setProgress);
      const url = extractUrl(result);
      const asset: Asset = { type: "image", url: url || "", prompt: `${currentFX.label}: ${sourceAsset.prompt}`, faceSwapped: sourceAsset.faceSwapped, model: currentFX.label };
      setResults(r => [asset, ...r]);
      addToLibrary(asset);
      setStatus("Done ✓"); setProgress(100);
    } catch (e: unknown) { setError(errorMessage(e)); setStatus(""); }
    setProcessing(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-title">Post-Processing FX</div>
        <div style={{ marginBottom: 14 }}>
          <span className="section-label">Source Image</span>
          {images.length === 0
            ? <div style={{ color: "var(--text3)", fontSize: 11 }}>Generate images first</div>
            : <div className="thumb-row">
                {images.map((img, i) => <img key={i} src={img.url} className={`thumb-img${sourceAsset === img ? " selected" : ""}`} alt="" onClick={() => setSourceAsset(img)} />)}
              </div>
          }
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {FX_OPTIONS.map(o => (
            <button key={o.id} className={`platform-btn${fx === o.id ? " selected" : ""}`} style={{ flex: "none", padding: "8px 14px" }} onClick={() => setFx(o.id)} data-testid={`fx-${o.id}`}>{o.label}</button>
          ))}
        </div>
        {fx === "dress" && (
          <div className="col" style={{ marginBottom: 12 }}>
            <span className="section-label">Outfit Description</span>
            <input type="text" value={dressPrompt} onChange={e => setDressPrompt(e.target.value)} placeholder='e.g. "elegant red cocktail dress with gold jewelry"' data-testid="input-dress-prompt" />
          </div>
        )}
        <button className="btn btn-gold btn-full" onClick={applyFX} disabled={processing || !sourceAsset} data-testid="button-apply-fx">{processing ? "Processing..." : `✦ Apply ${currentFX.label}`}</button>
        {processing && <GeneratingStatus status={status} progress={progress} />}
        {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      </div>
      {results.map((asset, i) => <AssetCard key={i} asset={asset} onSendToApex={setApexAsset} />)}
      {apexAsset && <ApexModal asset={apexAsset} onClose={() => setApexAsset(null)} />}
    </div>
  );
}

function LibrarySidebar({ library }: { library: Asset[] }) {
  return (
    <div className="sidebar">
      <div className="sidebar-title">Library · {library.length}</div>
      {library.length === 0
        ? <div style={{ color: "var(--text3)", fontSize: 11, lineHeight: 1.7 }}>Generated assets appear here</div>
        : <div className="lib-grid">
            {library.map((asset, i) => (
              <div key={i} className="lib-item">
                {asset.type === "video" ? <video src={asset.url} muted playsInline /> : <img src={asset.url} alt="" />}
                <div className="lib-type">{asset.type === "video" ? "VID" : "IMG"}</div>
                <div className="lib-overlay">
                  <a href={asset.url} download target="_blank" rel="noreferrer" className="btn btn-gold btn-sm" style={{ textDecoration: "none" }}>↓</a>
                </div>
              </div>
            ))}
          </div>
      }
    </div>
  );
}

function LaylaStudio() {
  const [apiKey, setApiKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [tab, setTab] = useState("layla");
  const [laylaFace, setLaylaFace] = useState<FaceRef>(null);
  const [laylaPrompt, setLaylaPrompt] = useState("");
  const [library, setLibrary] = useState<Asset[]>([]);

  const addToLibrary = useCallback((asset: Asset) => setLibrary(l => [asset, ...l]), []);

  const TABS = [
    { id: "layla", label: "✦ Layla" },
    { id: "images", label: "Images" },
    { id: "video", label: "Video" },
    { id: "cinema", label: "Cinema" },
    { id: "lipsync", label: "Lipsync" },
    { id: "postfx", label: "Post-FX" },
  ];

  if (!apiKey) return (
    <>
      <style>{css}</style>
      <div className="studio-root">
        <div className="login-wrap">
          <div className="login-card">
            <div className="login-logo">LAYLA</div>
            <div className="login-sub">AI Content Studio</div>
            <label className="login-label">muapi.ai API Key</label>
            <input type="text" className="login-input" value={keyInput} onChange={e => setKeyInput(e.target.value)}
              placeholder="Enter your muapi.ai key..." onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && keyInput) setApiKey(keyInput); }} data-testid="input-api-key" />
            <button className="login-btn" onClick={() => setApiKey(keyInput)} disabled={!keyInput} data-testid="button-enter-studio">Enter Studio →</button>
            <div className="login-hint">Get your key at <a href="https://muapi.ai/dashboard" target="_blank" rel="noreferrer">muapi.ai/dashboard</a></div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{css}</style>
      <div className="studio-root">
        <div className="header">
          <div className="header-logo">LAYLA</div>
          <div className="header-badge">Content Studio</div>
          <div className="header-right">
            <span className="header-key">{apiKey.slice(0, 8)}…</span>
            <button className="signout-btn" onClick={() => setApiKey("")} data-testid="button-sign-out-studio">Sign Out</button>
          </div>
        </div>
        <div className="tabs-row">
          {TABS.map(t => (
            <button key={t.id} className={`tab-btn${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>{t.label}</button>
          ))}
        </div>
        <div className="main">
          <div className="panel">
            {tab === "layla" && <TabLayla laylaFace={laylaFace} setLaylaFace={setLaylaFace} laylaPrompt={laylaPrompt} setLaylaPrompt={setLaylaPrompt} apiKey={apiKey} />}
            {tab === "images" && <TabImages laylaFace={laylaFace} laylaPrompt={laylaPrompt} apiKey={apiKey} addToLibrary={addToLibrary} />}
            {tab === "video" && <TabVideo laylaFace={laylaFace} laylaPrompt={laylaPrompt} apiKey={apiKey} library={library} addToLibrary={addToLibrary} />}
            {tab === "cinema" && <TabCinema apiKey={apiKey} library={library} addToLibrary={addToLibrary} />}
            {tab === "lipsync" && <TabLipsync apiKey={apiKey} library={library} addToLibrary={addToLibrary} />}
            {tab === "postfx" && <TabPostFX apiKey={apiKey} library={library} addToLibrary={addToLibrary} />}
          </div>
          <LibrarySidebar library={library} />
        </div>
      </div>
    </>
  );
}

export default function LaylaStudioPage() {
  const subAccountId = useActiveSubAccountId();
  const [, setLocation] = useLocation();
  const wasOnLaylaRef = useRef(false);

  useEffect(() => {
    if (subAccountId === LAYLA_ACCOUNT_ID) {
      wasOnLaylaRef.current = true;
    } else if (wasOnLaylaRef.current && subAccountId !== null && subAccountId !== LAYLA_ACCOUNT_ID) {
      setLocation("/dashboard");
    }
  }, [subAccountId, setLocation]);

  if (subAccountId !== LAYLA_ACCOUNT_ID) {
    return (
      <div style={{ padding: 48, maxWidth: 560, margin: "80px auto", textAlign: "center" }} data-testid="status-layla-forbidden">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "white", marginBottom: 12 }}>Content Studio</h1>
        <p style={{ color: "rgb(148 163 184)", marginBottom: 24, lineHeight: 1.6 }}>
          This studio is only available inside Officer Layla.
        </p>
        <Link href="/dashboard">
          <button
            style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "white", cursor: "pointer", fontSize: 13 }}
            data-testid="button-back-to-dashboard"
          >
            ← Back to Dashboard
          </button>
        </Link>
      </div>
    );
  }

  return <LaylaStudio />;
}
