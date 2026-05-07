# BOSSA AI OS — System Overview

## Purpose

BOSSA AI OS is an internal restaurant intelligence dashboard for BOSSA Asado i Mar.

It exists to turn operational signals into better weekly decisions.

## Core Loop

```text
Market Signals → Weekly Brief → Decisions → Actions → Learning Loop
```

## Primary Users

| User | Need |
| --- | --- |
| Owner / Operator | See what needs attention and decide fast |
| Marketing Lead | Understand promo pressure and campaign moves |
| Kitchen / Ops Lead | See operational risks before service |
| Analyst / AI Operator | Maintain signals, briefs, and decision memory |

## Current Architecture

```text
Google Sheets or data.json
        ↓
Data Adapter
        ↓
KPI Analyzer
        ↓
Decision Engine
        ↓
Action Engine
        ↓
Dashboard UI
```

## What the Dashboard Shows

- Executive summary
- Top threat
- Promo pressure
- Pricing actions
- Open decisions
- AI-generated decisions
- Action panel by owner
- Market signals
- Weekly brief
- Latest decisions

## Repo Boundaries

This repo is the technical AI OS prototype.

Use the separate `BOSSA-ASADO-I-MAR` repo for:

- business concept
- investor docs
- menu and brand materials
- restaurant planning archive

Use this repo for:

- dashboard code
- data schemas
- AI decision logic
- operating workflows
- deployment notes
