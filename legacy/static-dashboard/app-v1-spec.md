# BOSSA AI OS — App V1 Spec

## Goal
Build a simple internal dashboard that helps BOSSA decide what to do every week.

## Core features (V1)

### 1. Weekly Brief Generator
- input: competitor data
- output: structured weekly brief

### 2. Decision Panel
- show latest decisions
- allow adding new decisions

### 3. Market Signals
- top competitors
- pricing signals
- active promos

### 4. Action Panel
- what BOSSA should do this week
- priority actions

## UI idea
- simple dashboard
- 4 sections:
  - Signals
  - Brief
  - Decisions
  - Actions

## Data sources
- Notion (manual for now)
- future: API + database

## Tech direction (later)
- Next.js frontend
- Supabase database
- OpenAI API