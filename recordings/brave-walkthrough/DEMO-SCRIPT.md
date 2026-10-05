# Kept — 3‑minute walkthrough

**Site:** https://kept-virid-two.vercel.app

## Live demo script (~2:45)

| Time | You do | Say |
|------|--------|-----|
| **0:00** | Open **/** | “One link; PDF updates when GitHub changes.” |
| **0:20** | Hero: **Make a link**, **Try as guest**, **See an example** | “Three paths into the product.” |
| **0:35** | **See an example** → **/sample** (redirects to public `/r/…`) | “What recipients see—no app chrome.” |
| **0:55** | Home → **Try as guest** | “Real session, no signup.” |
| **1:10** | **Studio** + guest banner | “Sample repos until GitHub or an account.” |
| **1:25** | **Your links** (SPA) | “Fast `pushState` navigation.” |
| **1:40** | **New link** → studio | “Back to drafting.” |
| **1:50** | **/start** or **Connect GitHub** | “OAuth tied to your Kept session.” |
| **2:00** | **Leave guest mode** | “Clear session before auth demo.” |
| **2:10** | **/sign-in** (full page) | “Clerk auth; show/hide password.” |
| **2:25** | **/studio** signed out | “Guard → `/sign-in?next=/studio`.” |
| **2:35** | **/nope** → **Home** link | “Missing page, then SPA home.” |

## Record / audit

| Command | Output |
|---------|--------|
| `npm run walkthrough:audit` | Validates all steps → `recordings/walkthrough-audit.json` |
| `npm run demo:record` | `kept-walkthrough-full.mp4` (~2:40) |
| `npm run brave:demo` | Brave CDP → `kept-walkthrough.mp4` + PNGs |

Brave CDP: `chrome://inspect/#remote-debugging` → allow → `npm run brave:demo`.
