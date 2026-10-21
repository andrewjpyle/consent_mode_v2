# consent-mode-v2

Google **Consent Mode v2** — a drop-in, dependency-free implementation for Next.js, Vite/React SPAs, and server-rendered sites (Django, WordPress, Shopify, plain HTML).

MIT. No build step. No npm install required — vendor the file for your stack and go.

---

## The bug this exists for

You add Consent Mode. You set a page-level default of `granted`. You watch the consent ping fire in the network tab. Everything looks plumbed.

You collect nothing.

**A page-level `gtag('consent', 'default', {...})` does not override a Google Tag container's own denied default. Only an explicit `gtag('consent', 'update', {...})` does.**

That's it. That's the whole bug, and it is silent — no console error, no failed request, just an analytics property that quietly reports zero while every dashboard you look at says the tag is installed.

Every code path in this package therefore terminates in an `update`, including the path where the visitor is outside the EEA and no banner is ever shown.

---

## What it does

1. Default **all four** consent signals to `denied`, with `wait_for_update: 2000`.
2. If the visitor has already chosen, re-apply their stored choice.
3. Otherwise resolve their region from the **same-origin** Cloudflare `/cdn-cgi/trace` `loc=` field:
   - **Outside EEA/UK →** `granted` (full analytics, no banner friction)
   - **Inside EEA/UK →** `denied` until they accept
4. **Fail closed.** Any error — non-Cloudflare host, network failure, blocked request — resolves to `denied`.

A binary Accept/Reject banner (persisted to `localStorage`) lets anyone change their mind, and the stored choice is re-applied on subsequent loads.

The region lookup is **same-origin**, so there's no third-party geo-IP call and nothing extra to disclose in your own privacy policy.

---

## Install

Copy the file(s) for your stack out of `src/`. That's the install.

### Next.js (App Router)

```bash
cp src/react/ConsentMode.tsx src/react/CookieConsent.tsx  your-app/src/components/
```

```tsx
// app/layout.tsx
import ConsentMode from "@/components/ConsentMode";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <ConsentMode gaId={process.env.NEXT_PUBLIC_GA4_ID!} />
      </body>
    </html>
  );
}
```

Pass `adsId="AW-…"` as well if you run Google Ads.

If `gaId` is empty the component renders **nothing** — a misconfigured build fails visibly rather than silently falling back to a wrong container.

<details>
<summary><b>Multi-tenant</b> (one Next app serving many domains)</summary>

Resolve the measurement id from the request host in the server layout, then pass it down:

```tsx
import { headers } from "next/headers";

const HOST_TO_GA_ID: Record<string, string> = {
  "example.com":     "G-XXXXXXXXXX",
  "example.co.uk":   "G-YYYYYYYYYY",
};

export default async function RootLayout({ children }) {
  const host = (await headers()).get("host")?.replace(/^www\./, "") ?? "";
  const gaId = HOST_TO_GA_ID[host] ?? "";
  return <html><body>{children}<ConsentMode gaId={gaId} /></body></html>;
}
```
</details>

### Vite / React SPA

1. Paste `src/vite/index-head-snippet.html` into your `index.html` `<head>`, **before any other analytics or ad tag**. Replace `G-XXXXXXXXXX`.
2. Vendor `src/react/CookieConsent.tsx`, set `POLICY_HREF`, and mount it once near your app root.

### Server-rendered (Django / WordPress / Shopify / static)

`src/server-rendered/consent-snippet.html` has two parts: **(A)** into `<head>` before any other tag, **(B)** just before `</body>`. Vanilla JS, no React, no build step. Interpolate the measurement id with your template engine (`{{ ga_id }}`, `<?php echo $ga_id ?>`, `{{ settings.ga_id }}`).

If the site is **already** collecting, this is a compliance (EEA-gating) add rather than an analytics fix: replace the existing gtag init with part (A) and add part (B).

---

## Configuration

| What | Where | Default |
|---|---|---|
| `localStorage` key | `CONSENT_KEY` in each file | `cookie_consent_v1` |
| EEA/UK region list | `EEA_UK` in `src/consent-init.js` | 30 EEA states + `GB` |
| Privacy-policy link | `POLICY_HREF` in the banner | `/privacy-policy/#cookies` |

`src/consent-init.js` is the **source of truth** for the behavior. The per-stack files inline an equivalent so each drop-in stays zero-dependency — if you change the region list or the key, change it there and re-sync the inlined copies.

Want Switzerland treated as EEA? Add `'CH'` to `EEA_UK`.

The banners use **inline styles** on purpose — no Tailwind, no theme tokens, no CSS import — so they drop into any design system without fighting it. Restyle freely.

---

## Verifying it actually works

Do not trust "the tag is installed." Check the `gcs` parameter on the outbound hit:

| What you did | Expected `gcs` |
|---|---|
| Load from outside the EEA | `G111` (granted) |
| Click **Reject** | `G100` |
| Reload after rejecting | `G100` (persisted) |
| Click **Accept** | `G111` |

The EEA branch can't be exercised from a non-EEA IP. To test it, mock `/cdn-cgi/trace` to return `loc=DE` — or read the region list and trust the fail-closed default.

If you see `G100` when you expect `G111`, you are almost certainly looking at the container-default bug at the top of this README.

---

## Requirements

- Your site must be behind **Cloudflare** for the `/cdn-cgi/trace` geo lookup. It isn't behind Cloudflare? The lookup fails, the code fails closed to `denied`, and everyone sees the banner. That's a safe degradation, not a broken one — but you'll want to swap in your own region resolver.
- The measurement id should be injected at **build time** from your secret store, not committed.

## Tests

`npm test` runs `test/consent-init.test.js` with Node's built-in runner (Node 20 or newer, no install step). It checks that every branch ends in a `consent` `update`, that region lookup failures fail closed, and that the inlined copies in `src/` still use the same storage key and EEA/UK list as `src/consent-init.js`.

## License

MIT.

---

## Part of a larger system

`consent_mode_v2` is one of the reusable pieces pulled out of a private, autonomous build
system and released on its own — the machine needed it, so it built it, and now
it's yours too, MIT-licensed.

See the rest of the parts → **https://autonomousaj.com/parts**
