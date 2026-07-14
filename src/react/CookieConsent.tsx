"use client";

/*
 * Consent Mode v2 — cookie banner (Next.js / any React).
 *
 * Binary Accept-all / Reject-all, both prominent + a policy link. Shows only
 * when no choice is stored. On choice: gtag('consent','update', …) + persist to
 * localStorage under the shared key, which ConsentMode's init re-applies on
 * later loads. Styled with INLINE styles (no Tailwind/theme-token dependency)
 * so it drops into any repo; restyle freely.
 *
 * Set POLICY_HREF to the host site's cookie/privacy anchor.
 */
import { useEffect, useState } from "react";

const CONSENT_KEY = "cookie_consent_v1";
const POLICY_HREF = "/privacy-policy/#cookies"; // <-- set per site

type Choice = "granted" | "denied";

function applyConsent(choice: Choice) {
  if (typeof window !== "undefined" && typeof (window as any).gtag === "function") {
    (window as any).gtag("consent", "update", {
      ad_storage: choice,
      analytics_storage: choice,
      ad_user_data: choice,
      ad_personalization: choice,
    });
  }
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice, ts: Date.now() }));
  } catch {
    /* persistence unavailable — choice still applied this session */
  }
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const choose = (choice: Choice) => {
    applyConsent(choice);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        style={{
          maxWidth: 880, margin: "0 auto", display: "flex", flexWrap: "wrap",
          alignItems: "center", gap: 16, padding: "16px 20px", borderRadius: 12,
          background: "rgba(17,17,19,0.96)", color: "#e8e8ea",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.45)", fontSize: 14, lineHeight: 1.5,
        }}
      >
        <p style={{ flex: "1 1 280px", margin: 0 }}>
          We use cookies for analytics and to improve your experience. You can
          accept or reject non-essential cookies. See our{" "}
          <a href={POLICY_HREF} style={{ color: "#43ccad", textDecoration: "underline" }}>
            Privacy &amp; Cookie Policy
          </a>
          .
        </p>
        <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => choose("denied")}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500,
              cursor: "pointer", color: "#e8e8ea", background: "transparent",
              border: "1px solid rgba(255,255,255,0.24)",
            }}
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: "pointer", color: "#0b0b0c", background: "#43ccad",
              border: "1px solid #43ccad",
            }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
