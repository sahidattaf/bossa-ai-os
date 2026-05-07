# BOSSA AI OS Roadmap

## Product Positioning

BOSSA AI OS is the internal decision cockpit for BOSSA Asado i Mar.

It helps the owner and team convert weekly restaurant signals into clear decisions, assigned actions, and a learning loop.

---

## Phase 0 — Static Prototype Polish

Goal: Make the current dashboard reliable, readable, and deployable.

- [x] Clean README and repo identity
- [x] Add npm scripts for local preview
- [x] Add config example for live data
- [x] Add Google Sheets adapter with local fallback
- [x] Add modular analyzer, decision engine, and action engine
- [x] Clean fallback data schema
- [ ] Add deployment instructions
- [ ] Add dashboard screenshot to README

---

## Phase 1 — Live Sheets Operating System

Goal: Use Google Sheets as the lightweight backend.

- [ ] Finalize Google Sheets schema
- [ ] Add sample sheet tabs: KPIs, Signals, Decisions, Actions, Weekly Brief
- [ ] Add Apps Script endpoint documentation
- [ ] Add owner input form
- [ ] Add weekly review workflow
- [ ] Add CSV templates for import/export

---

## Phase 2 — BOSSA Decision Intelligence

Goal: Improve the decision engine so it reflects real restaurant operations.

- [ ] Add food cost % and labor % alerts
- [ ] Add inventory / 86 risk alerts
- [ ] Add weather and event-day notes
- [ ] Add competitor freshness score
- [ ] Add reservation pressure scoring
- [ ] Add action owner SLA rules
- [ ] Add completed-action learning notes

---

## Phase 3 — Public Demo + Internal Mode

Goal: Make the repo useful for partners, investors, and the operating team.

- [ ] Add public case-study landing page
- [ ] Add internal dashboard route
- [ ] Add demo data mode
- [ ] Add private/live mode notes
- [ ] Add privacy and data handling page

---

## Phase 4 — Next.js Upgrade

Goal: Move from static prototype to production dashboard.

- [ ] Create Next.js app
- [ ] Add typed data models
- [ ] Add authentication
- [ ] Add database layer
- [ ] Add admin dashboard
- [ ] Add automated weekly brief generation
- [ ] Deploy to Vercel

---

## North Star

Every week BOSSA should know:

1. What moved?
2. Why it matters?
3. What decision is needed?
4. Who owns it?
5. What did we learn?
