# Kept

Kept turns the work you publish on GitHub into a resume PDF with a stable link. When that work changes, the PDF is written again. The link stays the same.

The pages speak in plain language. This file is the technical map.

## What happens when GitHub changes

1. The person connects GitHub with OAuth. Public projects need `read:user` and `user:email`. Including private projects also requests the `repo` scope, which is what the GitHub API requires in order to read private repositories and to install a hook.
2. They pick repositories, including every public one from a single check, and write a brief for that version of the resume. Each link stores its own brief and role, so one person can keep a design version and an engineering version. When a role is set, a writing model only chooses which public projects to show, using each project's description. It does not rewrite those descriptions.
3. Kept reads those repositories through the official GitHub REST API (`https://api.github.com`, `X-GitHub-Api-Version: 2022-11-28`): repository metadata, README, languages, the file tree, releases, and the last 90 days of commit activity (`/stats/code_frequency` and `/stats/commit_activity`). If those stat endpoints are not ready, it falls back to the commit list. Private file contents are not part of this request.
4. Public projects with a thin README are read on the server: manifests and a handful of source files, then a conclusion from routes, a command name, and recent change messages. That source is not stored and is not sent to a writing model.
5. Private projects are different. The server never downloads their files. When the README does not explain the project, the browser fetches those files from GitHub and describes them with Gemma only (`onnx-community/gemma-3-270m-it-ONNX`, the q4f16 build, through Transformers.js on WebGPU, or the same Gemma build on WASM when WebGPU is missing). A sentence is kept only when it names the project and mentions something that actually appears in those files. Anything else is dropped, and the resume keeps the counts without a guessed description. Only that short conclusion is posted back. A remote writing model is not given private projects. Practice mode uses the bundled sample and the same in-browser Gemma path.
6. The numbers and the conclusion are saved in Tiger Data. The resume is composed from that saved context, not from the raw GitHub response.
7. `https://your-host/r/<slug>.pdf` always renders the latest saved resume. Opening the link also schedules a check when the last check is older than the poll interval. A private conclusion is refreshed only while the person's browser is open, because that is where Gemma runs.

Updates are discovered in two ways, both through GitHub's own API:

- **Polling.** On an interval (default 10 minutes) Kept calls `GET /repos/{owner}/{repo}` with the stored `ETag`. A `304` means nothing changed. A new `pushed_at` triggers a rebuild.
- **Hooks.** When the service has a public `https` URL and the person granted private-project access, Kept creates a repository hook with `POST /repos/{owner}/{repo}/hooks` for `push` and `release`. Deliveries are checked with `X-Hub-Signature-256`. Hooks are skipped on localhost because GitHub cannot reach it; polling still runs.

## Tiger Data

Production should use a Tiger Cloud service URL in `TIGER_DATABASE_URL`. The database is TimescaleDB, which Tiger Cloud runs for you.

Kept stores three hypertables, partitioned on `time`:

| Hypertable | What it holds |
| --- | --- |
| `project_signals` | Stars, forks, open issues, and the 90-day counts of updates, lines added, lines removed, and releases |
| `code_readings` | The conclusion used in the resume, and whether it had to be drawn from code |
| `link_updates` | Why a link was rewritten |

Star growth is not invented on the first read. It appears once two snapshots are at least an hour apart. `time_bucket('7 days', time)` turns those snapshots into a sentence such as "People starring Ledger went from 12 to 40." Line counts and release counts come from the GitHub window on the first version, so the PDF still has numbers before any history exists.

A local TimescaleDB container is in `docker-compose.yml` for development. It is the same engine Tiger Cloud uses.

## Writing briefs

The text box labeled "How should this version be written?" is the customizable brief. It is stored on the link and applied on every rebuild.

Without a writing model, Kept still uses it:

- "First person" switches the summary to first person.
- "Never mention …" and "Leave out …" remove matching projects, lines, and skills.
- The role and the brief reorder projects toward the words they use.

With `LLM_API_KEY` set, the role is sent with each public project's name and description. The model returns the names that fit that role. It does not rewrite descriptions, and private projects are left out of that request. If the model is unavailable, projects whose name or description contains a word from the role are kept instead.

## Run it locally

```bash
docker compose up -d
cp .env.example .env
npm install
npm test
npm start
```

Open `http://localhost:3000`. `http://localhost:3000/sample` opens one sample resume link. The same address is reused, and the page is the one a recipient would see.

## Sign-in

Log in and sign in go through Clerk, but the pages are Kept's own forms. Google is the way to use a Gmail account. Email and password are a separate Kept password, confirmed with a short email code for a new account. The prebuilt Clerk card is not mounted. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_CLERK_SECRET_KEY` (or `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`). In the Clerk dashboard, allow email and password plus email-code verification. Add the site origin (locally `http://localhost:3000`) so the browser session is accepted.

The browser loads Clerk's script from the frontend host encoded in the publishable key, and may load a quiet check from `challenges.cloudflare.com`. Those hosts are in the page's content security policy. The secret key stays on the server. `@clerk/express` reads the session cookie and creates a Kept account the first time that person is seen. GitHub is still a separate step, used only to read projects. Until it is connected, the account cannot list projects. Signing out revokes the Clerk session and clears the local session cookie.

If GitHub OAuth is not filled in, a local (non-production) server offers **Try it with sample projects**. That path still writes signals and readings into Tiger Data and serves a real PDF, so you can see both the history numbers and a conclusion drawn from code.

To connect a real GitHub account, create an OAuth app:

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Callback URL: `http://localhost:3000/github/auth/callback` (or `${PUBLIC_URL}/github/auth/callback`).
3. Put the client id and secret in `.env`.

`APP_SECRET` encrypts the GitHub access token at rest (AES-256-GCM). Changing it signs everyone out and makes saved tokens unreadable, so people need to connect GitHub again.

## Deploy on Render

`render.yaml` describes one web service. Render builds it with `npm ci` and starts it with `npm start`. Use a plan that stays up. A free instance that sleeps will not notice GitHub changes until the next request wakes it; the PDF request itself schedules a check, and the following open picks up the new version.

In the Render dashboard, set:

| Variable | Purpose |
| --- | --- |
| `TIGER_DATABASE_URL` | Tiger Cloud service URL. Prefer the pooled connection string. `sslmode=require` is expected; the app turns on TLS for any host that is not localhost. |
| `PUBLIC_URL` | The public `https` origin of this service, with no trailing slash. OAuth and hooks are built from it. |
| `GITHUB_CLIENT_ID` | OAuth app client id. Add `https://<your-service>/github/auth/callback` as a callback on the GitHub app. |
| `GITHUB_CLIENT_SECRET` | OAuth app secret. |
| `APP_SECRET` | Generated by the blueprint. |
| `WEBHOOK_SECRET` | Generated by the blueprint. Used as the hook secret. Changing it means hooks must be created again, which happens the next time a private-access link is refreshed. |
| `LLM_API_KEY` | Optional. OpenAI-compatible key. |
| `LLM_BASE_URL` | Optional. Defaults to `https://api.openai.com/v1`. |
| `LLM_MODEL` | Optional. Defaults to `gpt-4o-mini`. |
| `POLL_INTERVAL_MS` | Optional. Defaults to 600000 (10 minutes). |

Create the Tiger Cloud service first, copy its connection string, then deploy the blueprint (or connect this repo in Render and apply `render.yaml`).

Health check: `GET /health` runs `SELECT 1` against Tiger Data.

## Limits

- Every repository the account can see is offered, public and private, including paused projects and copies. One check selects all of the public ones. The role then chooses which of those public projects appear, using the whole write-up. That request turns storage off and is not written down here. A star count is shown only when it is above zero.
- Numbers in the PDF come from GitHub's counts or from the project's own README. The writer is not allowed to add a metric that was not in that evidence.
- Private projects are included only when the person chooses "Public and private projects." Their files are read in the browser by Gemma and are not stored. The PDF may show the project name and the short conclusion. A private project's URL is left off so the PDF does not point at a locked page. The page asks GitHub for those files with the person's own access, held in memory for that reading only.
- Anyone with the link can open the PDF. Shared pages send `noindex` and `robots.txt` disallows `/r/`.
- GitHub stat endpoints sometimes answer `202` while they compute. Kept uses the commit list until those stats exist, and says "the latest N updates" instead of "the last three months" when the count is only a sample.

## Tests

```bash
npm test
```

Unit tests cover README scoring, conclusions drawn from code, the star-history sentence, brief filters, rejection of invented percentages, hook signatures, encrypted tokens, and the PDF header. The Tiger Data test is skipped unless Postgres is listening on port 5433. With `docker compose up -d`, it creates a sample link, checks the hypertables, and downloads the PDF.
