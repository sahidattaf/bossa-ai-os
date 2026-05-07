# Google Sheets Schema

Use Google Sheets as the lightweight BOSSA AI OS backend during the prototype phase.

## Recommended Tabs

```text
Settings
KPIs
Signals
WeeklyBrief
Decisions
Actions
LearningLog
```

---

## Settings

| Column | Example |
| --- | --- |
| key | weekOf |
| value | 2026-W16 |

Common keys:

```text
weekOf
lastUpdated
topThreat
promoPressure
pricingActions
openDecisions
bossSummary
```

---

## KPIs

| Column | Example |
| --- | --- |
| revenue | 45000 |
| targetRevenue | 120000 |
| covers | 65 |
| targetCovers | 180 |
| avgCheck | 32 |
| foodCostPct | 0.32 |
| laborPct | 0.24 |

---

## Signals

| Column | Example |
| --- | --- |
| text | Soi95 running aggressive weekend promo |
| tag | High |
| owner | MarketingGPT |
| status | Active |

Accepted `tag` values:

```text
High
Medium
Low
Watch
```

---

## WeeklyBrief

| Column | Example |
| --- | --- |
| topThreat | Soi95 |
| biggestMovement | Weekend value offer pulling price-sensitive traffic |
| recommendedMove | Protect brand, test value bundle, avoid direct discounting |

---

## Decisions

| Column | Example |
| --- | --- |
| text | Bundle test for weekend traffic |
| owner | Ops Manager |
| status | Open |
| decisionDate | 2026-04-14 |

Accepted `status` values:

```text
Open
Pending
In Progress
Done
```

---

## Actions

| Column | Example |
| --- | --- |
| text | Launch value bundle test |
| owner | Marketing Team |
| priority | High |
| status | In Progress |
| dueDate | 2026-04-18 |

---

## LearningLog

| Column | Example |
| --- | --- |
| date | 2026-04-21 |
| decision | Bundle test for weekend traffic |
| result | Increased covers, protected avg check |
| keep | Bundle framing |
| fix | Earlier post schedule |
| nextTest | Add reservation CTA |

---

## JSON Shape Expected by Dashboard

```json
{
  "weekOf": "2026-W16",
  "lastUpdated": "2026-04-16",
  "topThreat": "Soi95",
  "promoPressure": "High",
  "pricingActions": 2,
  "openDecisions": 2,
  "bossSummary": "Protect premium perception this week.",
  "kpis": {
    "revenue": 45000,
    "targetRevenue": 120000,
    "covers": 65,
    "targetCovers": 180
  },
  "signals": [],
  "weeklyBrief": {},
  "decisions": [],
  "actions": []
}
```
