---
title: Kept — one resume link that stays current when the work does
published: true
tags: devchallenge, weekendchallenge, hf26challenge
---

*This is a submission for the [Hacktoberfest Weekend Challenge: Build for a Friend](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)*

## What I Built

[Name] ships on GitHub. The resume does not. The PDF they last sent still describes a project they have already rewritten, and the private work they are proudest of never makes the page, because they will not paste that code into a chatbot.

Kept is one link for them. They connect GitHub, choose the projects, and write a short brief for the role this version is for. A design role and an engineering role can each keep their own link and their own brief. The studio offers two choices: only public projects, or public and private. Anyone with the address opens a PDF. When those repositories change, Kept writes the PDF again. The link stays the same, so they do not email a new file every time the work moves on.

The counts come from GitHub: stars, forks, releases, and the latest commits in a 90-day window. A sentence about a project is kept only when it names the project and mentions something that actually appears in the files. If the model wanders, that sentence is dropped and the resume keeps the counts.

## Demo

Try it: [https://kept-virid-two.vercel.app](https://kept-virid-two.vercel.app)

The page a recipient sees: [https://kept-virid-two.vercel.app/sample](https://kept-virid-two.vercel.app/sample)

**Try as guest** walks the studio on the bundled sample projects, with no account. A guest session starts on public and private projects.

## Code

{% github Sumit884-byte/kept %}

[https://github.com/Sumit884-byte/kept](https://github.com/Sumit884-byte/kept)

## How I Built It

Two open-weight Gemma models, used for different jobs.

**Private projects stay on the computer.** When a private README is too thin to explain the project (no real sentence, fewer than twelve words, or a placeholder), the server stores the file paths and does not download the files. The browser asks GitHub for those files with the person's own token, holds them in memory, and runs [`onnx-community/gemma-3-270m-it-ONNX`](https://huggingface.co/onnx-community/gemma-3-270m-it-ONNX) (the q4f16 build) through [Transformers.js](https://github.com/huggingface/transformers.js). It uses WebGPU when the machine has it, and WASM when it does not. The prompt asks for one resume sentence that starts with the project name and mentions only actions or tools written in those files. A second check throws the sentence away unless the project name is in it and at least one word from the files is in it. Only that sentence is posted back. The files are not stored, and they are not sent to the larger model. A guest account uses the bundled sample files and the same in-browser path.

**Public projects are read through GitHub's API.** Kept pulls repository metadata, the README, languages, releases from the last 90 days, and up to 30 commits in that window. It does not call GitHub's stats endpoints, so added and removed lines stay at zero and the PDF says "The latest N updates." A thin public README is read on the server from up to two manifests and five source files. That source is used to write a conclusion from routes, a command name, and a recent commit message, then discarded.

**A role does not rewrite the resume.** The project list the studio shows has a name, description, language, and star count. With a role filled in, the page pre-selects up to eight projects from that list. After the repositories are read, and only when `LLM_BASE_URL` is set, the role string goes to an OpenAI-compatible endpoint with `store: false`. On Render that endpoint is **Gemma 3 4B Instruct**: [`gemma-3-4b-it-Q4_K_M.gguf`](https://huggingface.co/unsloth/gemma-3-4b-it-GGUF), served by [llama.cpp](https://github.com/ggml-org/llama.cpp) on a private service (2 CPUs, 8 GB). The model returns JSON, `skills` and `stacks`. It is not given project names, descriptions, conclusions, or source. Kept then matches those phrases locally against each public project's name, description, saved conclusion, highlights, and language, and keeps up to eight. Private projects stay out of that request and remain on the resume if they were selected. If the model is missing or returns nothing, the same match runs from the words in the role. The brief on each link still applies on every rebuild: first person, "never mention," and "leave out."

The PDF is drawn from that saved resume with `@react-pdf/renderer` and a classic template in `src/resumeTemplateClassic.js`. History lives in [Tiger Data](https://www.tigerdata.com/) (TimescaleDB). Three tables — project signals, the conclusion used on the resume, and why a link was rewritten — become hypertables on `time` when Timescale is present. A star change is attached only when an earlier row is at least an hour older. Weekly buckets use `time_bucket('7 days', time)`.

The PDF at `/r/<slug>.pdf` renders the latest saved resume. On Render, `npm start` polls on a timer (default 10 minutes). On the Vercel demo there is no background timer; opening a real link schedules a check when the last one is older than the poll interval. `/sample` there is the built-in example at `/r/keptsample` and does not use the database. Guest, the project list, and sign-in status are small functions and do not boot the full server. With private-project access and a public https URL, Kept also installs a push and release hook and checks `X-Hub-Signature-256`.

## Why Does Open Innovation Matter?

The private repositories are the ones [Name] will not copy onto a server they do not control, and they are often the ones a resume should mention. A closed chat API would take that source as the price of a paragraph. Gemma 3 270M is small enough to run in the browser, so the reading happens on their machine. I can refuse a sentence that does not match the files, because the weights, the prompt, and the filter are all in the project. The files never become a training example.

The same choice is why the role step is a 4B GGUF on a service I run, through llama.cpp. The request asks for skills and stacks, with storage off, and the project list is chosen afterward on our side. I can swap the GGUF. I can leave `LLM_BASE_URL` unset and the resume still builds from the brief and the GitHub counts. The writer is not allowed to add a metric that was not in the evidence.

Open weights are what make that rule enforceable. A retention promise on someone else's API is a policy. Running the model here is a property of the system.

## My Agent Session

<!-- Paste a DevRelay embed here if you have one:
{% agent_session https://devrelay.com/your-session %}
-->

## Prize Categories

- **Best Use of Gemma** — Gemma 3 270M in the browser for private projects, and Gemma 3 4B Instruct for turning a role into skills and stacks.
- **Best Use of Render** — the 4B model runs as a private llama.cpp service (`render.yaml`). The app calls it with the role only.
- **Best Use of Tiger Data** — GitHub signals, resume conclusions, and link rewrites are Timescale hypertables, so a star change shows up only after two readings at least an hour apart.
