# AuditCLI

A command-line website auditor for engineering, security, and marketing teams. Point it at a URL and get back broken links, security posture, SEO/content issues, performance, tech-stack fingerprinting, competitor benchmarking, and an AI root-cause analysis — rendered as an interactive local dashboard with charts, and pushed to Jira or Slack whenever *you* choose to (nothing files or posts automatically).

```
auditcli scan https://yourdomain.com --all
```

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands & options](#commands--options)
- [Configuration](#configuration-env)
- [The dashboard](#the-dashboard)
- [Security posture of this tool](#security-posture-of-this-tool)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)

## Features

**Auditing**
- Site crawler with broken link & broken asset detection
- Security header analysis (HSTS, CSP, X-Frame-Options, cookie flags, etc.)
- Passive security checks: TLS/SSL certificate health & expiry, DNS posture (SPF/DMARC/CAA), exposed sensitive files (`.env`, `.git`, backups), known-vulnerable JS library versions
- SEO & content audit (titles, meta descriptions, headings, duplicate content)
- Performance snapshot (load time, payload size, image count → 0–100 score)
- Tech-stack fingerprinting (frameworks, CMS, analytics, CDN)

**Competitive intelligence**
- Manual comparison against any URL (`--compare`)
- Automatic competitor discovery (`--discover-competitors`), category-aware (e-commerce, SaaS, food delivery, etc. — the query adapts to what kind of site it's auditing) via [SerpAPI](https://serpapi.com), with a no-key DuckDuckGo fallback

**AI root-cause analysis (on by default)**
- An **Issue → Root Cause → Suggested Fix** table generated via [OpenRouter](https://openrouter.ai), free tier by default
- Grounded by an in-process **RAG pipeline**: each finding is TF-IDF vectorised and cosine-matched against a curated vulnerability knowledge base (real CVEs, attack scenarios, remediation), and the retrieved entry is fed into the prompt — so advice cites correct header names and CVE numbers instead of improvising. Every row shows which knowledge-base entry grounded it.
- **Three-layer resilience** so it never comes back empty: configured model → fallback chain of other free models → a fully offline table built straight from the knowledge base (no model involved)
- **Response caching** — keyed on a hash of the prompt, so re-scanning a site whose findings haven't changed costs zero API requests

**Reporting**
- A severity-weighted **Risk Score**, separate from Performance Score, plus peer-relative z-score comparison against discovered competitors
- Interactive local web dashboard with charts (severity breakdown, top issue types, performance/risk meters, competitor comparisons, clickable per-page breakdown) — opens automatically after every scan
- **Manually add or edit issues** right in the dashboard, then ask the AI for a root-cause/fix suggestion on that specific finding — same RAG grounding as the main analysis, with prompt-injection guardrails since it's free-text input
- **Download PDF** button right in the dashboard (renders on demand — no file is written to disk unless you ask for one)
- JSON report always saved (powers the dashboard); Markdown or PDF saved to disk only if you pass `--format md` / `--format pdf`
- **Bot-protection detection** — if a site answers with a CAPTCHA/JS challenge instead of content, the report says so rather than scoring the challenge page as if it were your site

**Jira & Slack — always opt-in, never automatic**
- Nothing is filed or posted without you asking — not even `--all`. Push via explicit CLI flags (`--jira`, `--slack`) or, more commonly, the dashboard's buttons: per-issue "Jira"/"Slack" buttons, or "Push all to Jira" / "Post summary to Slack" in bulk
- Jira tickets get 4 labels (`auditcli`, `severity-*`, `category-*`, `type-*`) and auto-land on your board's **active sprint** (not just the backlog)
- Slack posts as one consolidated digest per scan (counts, risk score, top findings) rather than spamming a message per issue — plus a focused single-issue message from the per-row button

Every integration above is optional — a bare `auditcli scan <url>` works with zero configuration.

## Installation

**Requirements**

- [Node.js](https://nodejs.org) 18 or newer (`node --version` to check)
- Google Chrome or Microsoft Edge — only needed for PDF export; everything else works without it

**1. Get the code and install dependencies**

```bash
git clone https://github.com/SWAPNA2301/AuditCli.git
cd AuditCli
npm install
```

**2. Make `auditcli` available everywhere (recommended)**

```bash
npm link
```

That registers `auditcli` as a global command so you can run it from any
directory, in any terminal (PowerShell, cmd, or Git Bash):

```bash
auditcli scan https://example.com
```

<details>
<summary><strong>Windows: "auditcli is not recognized"</strong></summary>

npm's global folder isn't on your `PATH`. Add it once (PowerShell), then open a
**new** terminal:

```powershell
$npmGlobal = "$env:APPDATA\npm"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$npmGlobal*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$npmGlobal", "User")
}
```

PATH changes only apply to newly opened terminals. To refresh the one you're in:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","User") + ";" + [Environment]::GetEnvironmentVariable("Path","Machine")
```
</details>

To uninstall the global command later: `npm unlink -g auditcli`.

**Or skip linking and run it in place**

```bash
npm start -- scan https://example.com
```

The `--` is required so the flags reach the CLI instead of npm.

**3. Configure integrations (all optional)**

```bash
cp .env.example .env
```

Then fill in whichever keys you want — see [Configuration](#configuration-env).
Note that `npm link` points the global command at *this folder*, so if you move
or delete it, re-run `npm link` from the new location.

## Quick start

```bash
# Core audit — works with zero configuration
auditcli scan https://example.com

# Everything except Jira/Slack: all checks + AI analysis + competitor discovery
auditcli scan https://example.com --all

# Add explicit --jira / --slack if you actually want those to fire automatically
auditcli scan https://example.com --all --jira --slack
```

The interactive dashboard opens in your browser automatically when a scan
finishes. AI root-cause analysis runs by default on every scan. `--all` turns
on competitor discovery, but **never** auto-files Jira tickets or posts to
Slack — those are always a deliberate choice, either an explicit flag or a
button click in the dashboard.

## Commands & options

### `auditcli scan <url>`

Run a full audit against a website.

| Option | Description |
|---|---|
| `-a, --all` | Full checks + competitor discovery (does **not** file Jira or post Slack — add `--jira`/`--slack` explicitly if you want that too) |
| `-c, --compare <urls>` | Comma-separated competitor URLs to compare against |
| `--discover-competitors` | Auto-discover similar/competitor sites (category-aware search) |
| `-j, --jira` | Auto-create a Jira ticket for every issue found (needs Jira env vars) |
| `-s, --slack` | Post a one-message summary digest to Slack (needs Slack env vars) |
| `-p, --pages <n>` | Max pages to crawl (default `15`) |
| `-o, --out <dir>` | Directory to save reports to (default `./audit-reports`) |
| `--format <fmt>` | Save an extra deliverable file: `pdf` or `md` (default: none — JSON is always saved, and PDF is available on demand from the dashboard) |
| `--limit <n>` | Max issues to print in the terminal table (default `25`) |
| `--json` | Print raw JSON instead of formatted tables (for scripting/CI) |
| `--no-ai` | Skip the AI root-cause analysis (**on by default**) |
| `--no-web` | Skip auto-opening the dashboard (**on by default**) |

**Examples**

```bash
auditcli scan https://example.com --all                    # full pipeline
auditcli scan https://example.com --format pdf             # also save a PDF
auditcli scan https://example.com --compare https://rival.com
auditcli scan https://example.com --no-ai --no-web --json > result.json   # CI-friendly
```

### `auditcli view [url]`

Reopen the interactive dashboard for a previously saved report (the most recent one if no URL is given).

| Option | Description |
|---|---|
| `-o, --out <dir>` | Directory reports were saved to (default `./audit-reports`) |
| `--port <n>` | Dashboard port (default `4545`, or `DASHBOARD_PORT` from `.env`) |

## Configuration (.env)

Copy `.env.example` to `.env` and fill in whichever sections you want — everything is optional, and each feature degrades gracefully (with a clear message) if its variables are missing.

| Variable | Enables | Get it from |
|---|---|---|
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_ISSUE_TYPE` | `--jira` and the dashboard's Jira buttons. Use a **classic API token** (not "with scopes") — it works with the plain Basic Auth this tool uses, no extra setup | [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` | `--slack` and the dashboard's Slack buttons. Needs the `chat:write` scope, and the bot must be added to the target channel (`/invite @<bot-name>` in that channel) | [api.slack.com/apps](https://api.slack.com/apps) → your app → OAuth & Permissions |
| `OPENROUTER_API_KEY`, `AI_MODEL` | AI root-cause analysis (on by default). Use a small **non-reasoning** instruct model — reasoning models spend their token budget on hidden chain-of-thought and return nothing usable | [openrouter.ai/keys](https://openrouter.ai/keys) (free tier available) |
| `SERPAPI_KEY` | Reliable `--discover-competitors` (falls back to a best-effort DuckDuckGo scrape without it) | [serpapi.com](https://serpapi.com) (free tier available) |
| `DASHBOARD_PORT` | Port for the local dashboard | — (defaults to `4545`) |

`.env` is gitignored — never commit it. Use `.env.example` as the template for what to fill in. It's read from AuditCLI's own folder regardless of which directory you run `auditcli` from, so the global command works the same everywhere.

## The dashboard

Every scan opens a local dashboard (`http://localhost:4545` by default) with:

- KPI cards (total issues, severity breakdown, performance score, risk score)
- Interactive charts with hover tooltips: performance & risk meters, severity breakdown, top issue types, knowledge-base coverage, and — when competitors are included — performance and issue-count comparisons by site
- A filterable issues table, plus a **per-page breakdown you can click** to filter the table down to a single page
- **"+ Add issue"** to log a finding manually, **"Edit"** on any row, and **"AI suggest"** to get a root-cause/fix for that specific issue on demand
- The AI root-cause table, with a citation chip on each row showing which knowledge-base entry grounded it
- Brand-colored **Jira** (blue) and **Slack** (aubergine) buttons — per issue, or "Push all to Jira" / "Post summary to Slack" in bulk. Nothing sends automatically; every push is a click
- "Download PDF" — renders on demand via headless Chrome/Edge and downloads straight from the browser

It's a plain Express server serving a single self-contained HTML page (no build step, no framework — that's what actually renders in any browser regardless of what UI framework generated it). No `.html` file is ever written to disk; only the JSON snapshot is saved automatically, with PDF/Markdown as opt-in deliverables (`--format pdf` / `--format md`, or the dashboard's PDF button).

## Security posture of this tool

The security checks in this tool are **deliberately passive/non-intrusive only**: TLS handshake inspection, DNS lookups, security-header reads, static JS-library version matching, and plain `GET` requests to a short list of well-known paths (the same kind of requests SecurityHeaders.com or SSL Labs make against any public site). There is **no active exploitation, no credential brute-forcing, no port scanning, and no payload injection** — the CLI accepts arbitrary URLs with no way to verify the caller owns or is authorized to test the target, so anything more intrusive is out of scope by design. Use it against sites you own or are authorized to assess.

## Project structure

```
src/
  index.js                  CLI entry point & commands
  lib/
    auditor.js               orchestrates the full check pipeline
    crawler.js                site crawler
    ai.js                      OpenRouter client (RAG grounding + model fallback chain + offline fallback)
    aiCache.js                prompt-hash response cache (repeat scans cost zero API requests)
    vectorRag.js             TF-IDF vector index + cosine similarity retrieval (RAG retrieval layer)
    vulnKnowledgeBase.js  curated vulnerability/remediation corpus (RAG source material)
    riskScore.js               severity-weighted risk score + peer-relative z-score stats
    competitors.js           SerpAPI/DuckDuckGo-based, category-aware competitor discovery
    jira.js                     Jira issue creation (labels, active-sprint assignment, structured description)
    slack.js                    Slack digest + single-issue messages (Block Kit)
    report.js                 report generation (HTML in-memory, MD/JSON to disk) + manifest
    pdf.js                      on-demand PDF rendering via headless Chrome/Edge
    webServer.js            local Express dashboard + Jira/Slack push + PDF export API
    dashboardTemplate.js  dashboard front-end (vanilla JS, no build step)
    chartKit.js               shared SVG chart components (dashboard + PDF report)
    reportStyles.js         shared CSS (dashboard + PDF report)
    noise.js                   analytics/tracking-pixel URL filtering
  checks/
    brokenLinks.js, securityHeaders.js, seoContent.js, techStack.js,
    performance.js, ssl.js, dnsWhois.js, exposedFiles.js, vulnerableLibs.js
```

## Roadmap

- Accessibility audit (axe-core)
- Lighthouse integration
- Slack channel routing by issue category/team (currently one channel via `SLACK_CHANNEL_ID`)

## License

MIT
