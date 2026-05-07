# BOSSA AI OS

Internal AI-powered operating system prototype for **BOSSA Asado i Mar** — a Curaçao fire-grill restaurant and rooftop hospitality concept.

BOSSA AI OS turns scattered restaurant signals into a weekly operating rhythm:

```text
Market Signals → Weekly Brief → Decisions → Actions → Learning Loop
```

The current version is a lightweight static dashboard that can run locally, connect to Google Sheets through Apps Script, and fall back to local demo data when no live source is configured.

---

## Status

| Area | Status |
| --- | --- |
| Dashboard prototype | Active |
| Google Sheets adapter | Active with fallback data |
| AI decision rules | Prototype |
| Backend/API | Not yet implemented |
| Deployment | Static hosting ready |

---

## What This Repo Is

This repo is the **technical AI Ops product** for Bossa.

It is designed to help the owner and team answer:

- What changed this week?
- Which risks need attention?
- Which decision should we make now?
- Who owns the next action?
- What did we learn after execution?

---

## What This Repo Is Not

This is not the full business plan or investor archive. Keep those in the business codex repo:

- `BOSSA-ASADO-I-MAR` → business, brand, menu, investor, and concept archive
- `bossa-ai-os` → dashboard, decision logic, data schemas, and AI Ops workflow

---

## Current Features

- Executive dashboard for signals, decisions, actions, and weekly brief
- High-priority action focus mode
- Google Sheets / Apps Script data loading
- Local `data.json` fallback for demos
- Modular AI logic:
  - KPI analyzer
  - decision engine
  - action engine
  - scoring rules
- Local daily input stored in browser `localStorage`

---

## Run Locally

Using npm:

```bash
npm run dev
```

Or directly:

```bash
cd src
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

---

## Live Data Setup

By default, the dashboard uses `src/data.json`.

To connect Google Sheets:

1. Copy `src/config.example.js` to `src/config.js`.
2. Paste your Google Apps Script Web App URL.
3. Keep real URLs out of public commits when possible.

Example:

```js
window.BOSSA_CONFIG = {
  GOOGLE_APPS_SCRIPT_WEB_APP_URL: "https://script.google.com/macros/s/YOUR_ID/exec"
};
```

---

## Recommended Folder Map

```text
bossa-ai-os/
├── docs/                 # system docs and schemas
├── operations/           # weekly review and owner playbooks
├── src/                  # static dashboard prototype
│   ├── ai/               # analyzer, decision, action logic
│   ├── adapters/         # data adapters
│   ├── assets/           # dashboard screenshots and visuals
│   └── data.json         # fallback demo data
├── templates/            # Sheets columns and brief templates
├── ROADMAP.md
└── README.md
```

---

## Product Roadmap

See [`ROADMAP.md`](./ROADMAP.md).

Next priorities:

1. Stabilize static dashboard and data schema.
2. Deploy as a static site.
3. Expand KPI and scoring rules.
4. Add weekly brief export.
5. Upgrade to a Next.js dashboard when the workflow is proven.

---

## BOSSA Operating Principle

> Decide fast. Route clean. Review outcomes. Memory compounds.

The goal is not to replace the owner. The goal is to make the owner’s weekly decisions clearer, faster, and easier to track.
