---
name: ship-kept
description: >-
  Verifies a Kept change, then updates the README, rewrites the local
  gitignored blog.md, pushes to GitHub, and deploys production. Use when
  finishing a Kept feature or fix, or when the user asks to update the README,
  update blog.md, push to GitHub, or ship.
---

# Ship Kept

Verification is the last step before the README, `blog.md`, and git. Do not edit those, commit, push, or deploy while a check is still failing.

## Order

1. Change the product.
2. Verify. If something fails, fix it and verify again. Repeat until the changed flow passes.
3. Update `README.md` so it matches the verified behavior.
4. Rewrite `blog.md` for the same behavior. Leave it untracked.
5. Commit everything except secrets and `blog.md`, push to GitHub, then deploy Vercel production.

## Verify

Run `node --test test/unit.test.js`.

For a UI, routing, or sign-in change, exercise the flow in Brave:

- If `http://127.0.0.1:9222/json/version` responds, that is the Brave debug session. Drive it with browser-use and `BU_CDP_URL=http://127.0.0.1:9222`.
- If it does not respond, launch a separate Brave with `--remote-debugging-port` and a temporary `--user-data-dir`. Do not pass the normal Brave profile. Close only that process when finished.
- A guest session sends `/sign-in` to `/studio`. Sign out before checking log in.
- Do not create a Gmail account. When a code is required, use a temporary inbox you can read.

## README

Describe the behavior that just passed. Derive it from the code, not from an older paragraph.

## blog.md

`blog.md` is the local DEV Community post, "Kept — a resume link I made for Rahul." Keep the front matter and these tags: `devchallenge`, `weekendchallenge`, `hf26challenge`. Rahul is the friend. Do not invent a quote or extra biography.

`.gitignore` must contain a `blog.md` line. If Git still tracks the file, run `git rm --cached blog.md` and keep the local file. Never stage or commit it.

## Push

Commit the verified product change, the README update, and nothing secret. Do not commit `.env` or `blog.md`. Push to `origin`. Then run `vercel --prod --yes` so https://kept-virid-two.vercel.app matches that push.

Skip the push and the deploy when the user said to hold the change.
