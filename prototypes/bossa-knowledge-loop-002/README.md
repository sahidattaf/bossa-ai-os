# BOSSA Knowledge Loop 002 — Synthetic Read-Only Prototype

Gate: GPTI-KNOWLEDGE-LOOP-002. Synthetic/historical fixture examples only. No network, credentials, customer data, Notion writes, reservations, payments or publication.

Three roles: `answer` (tenant-scoped evidence retrieval), `report` (gap proposal only), `verify` (source checks and write denial). Evidence fields: `id`, `tenant`, `topic`, `value`, `date`, `status`, `source`. Historical data is **never** silently treated as approved.

Run: `node --test knowledge.test.mjs` (Node 20+). The twelve cases represent a deterministic prototype contract, **not** live connector, language-generation, RLS or production acceptance. EN/PAP/NL/ES test checks accepted language codes and consistent evidence status, not translation quality.

Future owner gates required for production integration, new permissions, live data, Notion writes, merge, and deployment.
