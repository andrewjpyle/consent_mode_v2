/*
 * Consent Mode v2 — Next.js App Router drop-in.
 *
 * Renders (a) the gtag.js loader, (b) the consent-default-denied + geo-resolve
 * init, (c) optional secondary destinations (Google Ads), and (d) the cookie
 * banner. Drop a single <ConsentMode gaId={...} /> into the root layout's
 * <body>. Self-contained (the region list + key are inlined to match
 * shared/consent-init.js) so no cross-repo import is needed.
 *
 * Single-tenant:   <ConsentMode gaId={process.env.NEXT_PUBLIC_GA4_ID!} />
 * Multi-tenant:    resolve the id by request host in the (server) layout and
 *                  pass it in — see README "Multi-tenant".
 *
 * If gaId is empty the whole block is omitted (so a misconfigured build never
 * silently falls back to a wrong/contaminated container).
 */
import Script from "next/script";
import CookieConsent from "./CookieConsent";

type Props = {
  /** The site's own GA4 measurement id (G-…) or Google Tag container (GT-…). */
  gaId: string;
  /** Optional Google Ads id (AW-…) added as a secondary gtag('config') destination. */
  adsId?: string;
};

export default function ConsentMode({ gaId, adsId }: Props) {
  if (!gaId) return null;

  const configLines = [`gtag('config', '${gaId}');`];
  if (adsId) configLines.push(`gtag('config', '${adsId}');`);

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());

          // Consent Mode v2 — default DENIED (a page-level default can't override
          // the container's denied default; only an explicit 'update' can), then
          // resolve via stored choice or Cloudflare /cdn-cgi/trace geo and apply
          // with 'update'. Non-EEA/UK -> granted; EEA/UK -> denied until accept.
          gtag('consent', 'default', {
            ad_storage: 'denied', analytics_storage: 'denied',
            ad_user_data: 'denied', ad_personalization: 'denied',
            wait_for_update: 2000
          });
          gtag('set', 'ads_data_redaction', true);
          gtag('set', 'url_passthrough', true);
          (function () {
            var KEY = 'cookie_consent_v1';
            var EEA = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB'];
            function setConsent(v) {
              gtag('consent', 'update', {
                ad_storage: v, analytics_storage: v, ad_user_data: v, ad_personalization: v
              });
            }
            try {
              var c = JSON.parse(localStorage.getItem(KEY) || 'null');
              if (c && c.choice) { setConsent(c.choice === 'granted' ? 'granted' : 'denied'); return; }
            } catch (e) {}
            fetch('/cdn-cgi/trace').then(function (r) { return r.text(); }).then(function (t) {
              var m = t.match(/loc=([A-Z][A-Z])/);
              var loc = m ? m[1] : '';
              setConsent(loc && EEA.indexOf(loc) === -1 ? 'granted' : 'denied');
            }).catch(function () { setConsent('denied'); });
          })();

          ${configLines.join("\n          ")}
        `}
      </Script>
      <CookieConsent />
    </>
  );
}
