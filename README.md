# Kept

Kept turns the work you publish on GitHub into a resume PDF with a stable link. When that work changes, the PDF is written again. The link stays the same.

The pages speak in plain language. This file is the technical map.

## What happens when GitHub changes

1. The person connects GitHub with OAuth. The grant is always `read:user`, `user:email`, and `repo`. The `repo` scope is what the GitHub API requires in order to read private repositories and to install a hook. The studio then chooses a visibility for that link: public projects only, or public and private. A link set to public does not list private repositories, even though the token can see them.
2. They pick repositories and write a brief for that version of the resume. Each link stores its own brief and role, so one person can keep a design version and an engineering version. Profile repositories named `owner/owner` are not offered. Disabled repositories are not listed. With no role, an empty selection fills with every non-fork project in that visibility. With a role, the page pre-selects up to eight projects whose name, description, saved conclusion, highlights, or language match the role. Forks can be dropped with "Leave out copies."
3. Kept reads those repositories through the official GitHub REST API (`https://api.github.com`, `X-GitHub-Api-Version: 2022-11-28`): repository metadata, the README, languages, releases from the last 90 days, and up to 30 commits since that same window. It does not call `/stats/code_frequency` or `/stats/commit_activity`. Line added and line removed stay at zero on this path, and the window is marked incomplete, so the PDF says "The latest N updates" rather than "the last three months." Private file contents are not part of this request.
4. A README is thin when it has no real sentence, fewer than twelve words, or a placeholder. Public projects with a thin README are read on the server: up to two manifests and five source files, then a conclusion from routes, a command name, and a recent change message. That source is used to write the conclusion and is not saved.
5. Private projects are different. The server never downloads their files. When the README is thin, it stores the file paths and marks the reading as needing a local pass. The browser fetches those files from GitHub and describes them with Gemma only (`onnx-community/gemma-3-270m-it-ONNX`, the q4f16 build, through Transformers.js on WebGPU, or the same Gemma build on WASM when WebGPU is missing). A sentence is kept only when it names the project and mentions something that actually appears in those files. Anything else is dropped, and the resume keeps the counts without a guessed description. Only that short conclusion is posted back. A remote writing model is not given private projects. Practice mode uses the bundled sample and the same in-browser Gemma path.
6. The numbers and the conclusion are saved in Tiger Data. The resume is composed from that saved context, not from the raw GitHub response.
7. `https://your-host/r/<slug>.pdf` renders the latest saved resume. Opening the link also schedules a check when the last check is older than the poll interval. The static example slug `keptsample` does not. A private conclusion is refreshed only while the person's browser is open, because that is where Gemma runs.

Updates are discovered in two ways, both through GitHub's own API:

- **Polling.** On a long-running process (`npm start`, including Render) a timer asks which links are due. The interval defaults to 10 minutes and is never shorter than 15 seconds between ticks. Each check calls `GET /repos/{owner}/{repo}` with the stored `ETag`. A `304` means nothing changed. A new `pushed_at` triggers a rebuild. Opening `/r/<slug>` schedules the same check, including on Vercel, where there is no background timer.
- **Hooks.** When the service has a public `https` URL, the link includes private projects, and the token's scope includes `repo`, Kept creates a repository hook with `POST /repos/{owner}/{repo}/hooks` for `push` and `release`. Deliveries arrive at `/api/github/webhook` and are checked with `X-Hub-Signature-256`. Hooks are skipped on localhost because GitHub cannot reach it; polling still runs.

## How a role chooses projects

The text box labeled "How should this version be written?" is the customizable brief. It is stored on the link and applied on every rebuild.

Without a writing model, Kept still uses it:

- "First person" switches the summary to first person.
- "Never mention …" and "Leave out …" remove matching projects, lines, and skills.
- The role and the brief reorder projects toward the words they use.

When `LLM_BASE_URL` is set, the role string is sent to an OpenAI-compatible chat endpoint. The model is asked for JSON with two keys, `skills` and `stacks`. It is not given project names, descriptions, or source, and the request sets `store` to false. A bearer token is sent only when `LLM_API_KEY` is set. Those terms are then matched locally against each public project's name, description, conclusion, highlights, and language. Up to eight names are kept. Private projects are left out of that request and stay on the resume if they were selected. If the model is missing or returns nothing, the same local match runs from the words in the role. If fewer than three public names match, more are filled from that local match. The model does not rewrite descriptions.

On Render, `LLM_BASE_URL` points at the private Gemma service and `LLM_MODEL` is `gemma-3-4b-it`.

## Tiger Data

Production should use a Tiger Cloud service URL in `TIGER_DATABASE_URL` (or `DATABASE_URL`). The database is TimescaleDB, which Tiger Cloud runs for you. Any host that is not localhost gets TLS.

Kept stores three tables, and turns them into hypertables on `time` when the `timescaledb` extension is present:

| Table | What it holds |
| --- | --- |
| `project_signals` | Stars, forks, open issues, watchers, the commit count in the window, releases, and the README score. Additions and deletions are columns; the GitHub read currently stores zero for both. |
| `code_readings` | The conclusion used in the resume, whether the README was thin, and a JSON detail (highlights, skills, and, for a private thin README, the file paths still waiting on the browser). |
| `link_updates` | Why a link was rewritten. |

Star growth is not invented on the first read. A change is attached when an earlier row for that project is at least an hour older. Weekly buckets use `time_bucket('7 days', time)` on Timescale, or `date_trunc('week', time)` when the extension is missing. Two buckets with a higher later star count become a sentence such as "People starring Ledger went from 12 to 40." The sample projects insert an earlier snapshot so that sentence can appear before any real history exists. A live GitHub project does not get line counts on the first version, because those fields stay zero.

A local TimescaleDB container is in `docker-compose.yml` for development. It is the same engine Tiger Cloud uses.

## Run it locally

```bash
docker compose up -d
cp .env.example .env
npm install
npm test
npm start
```

Open `http://localhost:3000`. `http://localhost:3000/sample` creates one sample resume link in the database and redirects to it. The page is the one a recipient would see. If that write fails, the same address falls back to `/r/keptsample`, a built-in example that does not use the database.

**Try as guest** (`POST /api/guest`) starts a real session on the sample projects. It is offered whether or not GitHub OAuth is configured.

## Sign-in

Log in and sign in go through Clerk, but the pages are Kept's own forms. Google is the way to use a Gmail account. Email and password are a separate Kept password, confirmed with a short email code for a new account. The prebuilt Clerk card is not mounted. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_CLERK_SECRET_KEY` (or `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`). In the Clerk dashboard, allow email and password plus email-code verification. Add the site origin (locally `http://localhost:3000`) so the browser session is accepted.

The browser loads Clerk's script from the frontend host encoded in the publishable key, and may load a quiet check from `challenges.cloudflare.com`. Those hosts are in the page's content security policy. The secret key stays on the server. `@clerk/express` reads the session cookie and creates a Kept account the first time that person is seen. GitHub is still a separate step, used only to read projects. Until it is connected, a real account cannot list projects. A guest account lists the sample projects instead. Signing out revokes the Clerk session and clears the local session cookie.

To connect a real GitHub account, create an OAuth app:

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Callback URL: `http://localhost:3000/github/auth/callback` (or `${PUBLIC_URL}/github/auth/callback`).
3. Put the client id and secret in `.env`.

`APP_SECRET` encrypts the GitHub access token at rest (AES-256-GCM). Changing it signs everyone out and makes saved tokens unreadable, so people need to connect GitHub again.

## Deploy

### Render

`render.yaml` describes the web service and a private Gemma service. Render builds the web service with `npm ci` and starts it with `npm start`, so the poller runs. Use a plan that stays up. A free instance that sleeps will not notice GitHub changes until the next request wakes it; the PDF request itself schedules a check, and the following open picks up the new version.

The private service is `ghcr.io/ggml-org/llama.cpp:server`. On first boot it downloads `gemma-3-4b-it-Q4_K_M.gguf` from Unsloth into a 5 GB disk and serves it as `gemma-3-4b-it`. The plan is 2 CPUs and 8 GB of memory.

In the Render dashboard, set:

| Variable | Purpose |
| --- | --- |
| `TIGER_DATABASE_URL` | Tiger Cloud service URL. Prefer the pooled connection string. `sslmode=require` is expected; the app turns on TLS for any host that is not localhost. |
| `PUBLIC_URL` | The public `https` origin of this service, with no trailing slash. OAuth and hooks are built from it. |
| `GITHUB_CLIENT_ID` | OAuth app client id. Add `https://<your-service>/github/auth/callback` as a callback on the GitHub app. |
| `GITHUB_CLIENT_SECRET` | OAuth app secret. |
| `APP_SECRET` | Generated by the blueprint. |
| `WEBHOOK_SECRET` | Generated by the blueprint. Used as the hook secret. Changing it means hooks must be created again, which happens the next time a private-access link is refreshed. |
| `LLM_BASE_URL` | Set by the blueprint to the private model service (`host:port`). The app adds `http://` and `/v1`. |
| `LLM_MODEL` | `gemma-3-4b-it`. The private service runs Gemma 3 4B Instruct. |
| `LLM_API_KEY` | Not used for the private model. Set it only if you point `LLM_BASE_URL` at a host that asks for a key. |
| `POLL_INTERVAL_MS` | Optional. Defaults to 600000 (10 minutes). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key, if sign-in is on. |
| `NEXT_PUBLIC_CLERK_SECRET_KEY` | Clerk secret key. |

Create the Tiger Cloud service first, copy its connection string, then deploy the blueprint (or connect this repo in Render and apply `render.yaml`).

Health check: `GET /health` runs `SELECT 1` against the database.

### Vercel

`vercel.json` serves the pages from `src/public` and sends `/api`, `/r`, `/sample`, `/github`, and `/health` through `api/server.js`. There is no background poller. A check still runs when someone opens a real `/r/<slug>` link and the last check is older than the poll interval. `/sample` redirects to `/r/keptsample`, which is rendered from the built-in example and does not need the database. The role model runs only when `LLM_BASE_URL` is set on that project; otherwise the role match stays local.

## Limits

- A star count is shown only when it is above zero.
- Numbers in the PDF come from the saved GitHub counts or from sentences in the README. The writer is not allowed to add a metric that was not in that evidence. Commit counts are the latest commits returned for the window, not a full three-month stat.
- Private projects are included only when the person chooses "Public and private projects." Their files are read in the browser by Gemma and are not stored. The PDF may show the project name and the short conclusion. A private project's URL is left off so the PDF does not point at a locked page. The page asks GitHub for those files with the person's own access, held in memory for that reading only.
- Anyone with the link can open the PDF. Shared pages send `X-Robots-Tag: noindex, nofollow` and a `noindex` meta tag.

## Tests

```bash
npm test
```

Unit tests cover README scoring, conclusions drawn from code, the star-history sentence, brief filters, rejection of invented percentages, hook signatures, encrypted tokens, and the PDF. The Tiger Data test is skipped unless Postgres is listening on port 5433. With `docker compose up -d`, it creates a sample link, checks the hypertables, and downloads the PDF.
