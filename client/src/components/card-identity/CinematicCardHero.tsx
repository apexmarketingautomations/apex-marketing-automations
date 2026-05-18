/**
 * client/src/components/card-identity/CinematicCardHero.tsx
 *
 * Replaces the plain gradient hero on public card views when identityDna is set.
 * WebGL scene as background with profile photo + branding overlay.
 */

import React, { Suspense } from "react";
import type { IdentityVisualDNA } from "@/lib/card-identity/schema";
import { WebGLIdentityScene } from "./WebGLIdentityScene";

interface Props {
  dna: IdentityVisualDNA;
  photoUrl?: string;
}

function WebGLFallback({ dna }: { dna: IdentityVisualDNA }) {
  return (
    <div
      style={{
        height: "280px",
        background: `linear-gradient(135deg, ${dna.colors.background} 0%, ${dna.colors.surface} 50%, ${dna.colors.primary}22 100%)`,
      }}
    />
  );
}

export function CinematicCardHero({ dna, photoUrl }: Props) {
  return (
    <div style={{ height: "280px", position: "relative", overflow: "hidden" }}>
      {/* WebGL scene as background */}
      <Suspense fallback={<WebGLFallback dna={dna} />}>
        <WebGLIdentityScene dna={dna} height="280px" />
      </Suspense>

      {/* Gradient overlay from bottom */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "1.25rem 1.5rem",
        }}
      >
        {/* Profile photo floating at bottom-left */}
        {photoUrl && (
          <img
            src={photoUrl}
            alt="Profile"
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              border: `3px solid ${dna.colors.primary}`,
              objectFit: "cover",
              marginBottom: "0.5rem",
              boxShadow: `0 0 20px ${dna.colors.primary}44`,
            }}
          />
        )}

        {/* Authority hook pill */}
        {dna.branding.authorityHook && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: dna.colors.primary + "22",
              border: `1px solid ${dna.colors.primary}44`,
              borderRadius: 999,
              padding: "4px 12px",
              marginBottom: "0.4rem",
              width: "fit-content",
              backdropFilter: "blur(8px)",
            }}
          >
            <span
              style={{
                color: dna.colors.primary,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              {dna.branding.authorityHook}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
