import type { PlatformAdapter } from "./types";
import { instagramAdapter } from "./instagram";
import { facebookAdapter } from "./facebook";
import { xAdapter } from "./x";
import { tiktokAdapter } from "./tiktok";

const adapters: Record<string, PlatformAdapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  x: xAdapter,
  tiktok: tiktokAdapter,
};

export function getAdapter(platform: string): PlatformAdapter | null {
  return adapters[platform] || null;
}

export function getSupportedPlatforms(): string[] {
  return Object.keys(adapters);
}

export type { PlatformAdapter, PublishInput, PublishResult } from "./types";
