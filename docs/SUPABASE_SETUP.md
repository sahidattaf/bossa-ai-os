# BOSSA AI OS — Supabase Setup

Supabase is the live data layer for BOSSA AI OS.

```text
Notion = planning brain
Supabase = live operational data
Static dashboard / future Next.js = app layer
Vercel = hosting
AI agents = analysis and recommendations
```

## Project

```text
Name: bossa-ai-os
URL: https://oqmftkttkfktyzefswpz.supabase.co
Database: PostgreSQL 17
Status: ACTIVE_HEALTHY
```

## Tables

The current schema creates:

```text
users_profiles
campaigns
content_items
whatsapp_leads
orders
bookings
menu_items
kpi_daily
decision_log
weekly_briefs
agent_runs
```

## Apply schema

The production Supabase project already has this schema applied.

For a fresh project, run:

```bash
supabase db push
```

Or paste `supabase/schema.sql` into the Supabase SQL Editor.

## Browser config for current static dashboard

Copy:

```bash
cp src/config.example.js src/config.js
```

Then fill:

```js
globalThis.BOSSA_CONFIG = {
  GOOGLE_APPS_SCRIPT_WEB_APP_URL: "",
  SUPABASE_URL: "https://your-project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "your_supabase_publishable_key"
};
```

Load the browser SDK before the adapter:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="adapters/supabaseAdapter.js"></script>
```

## Security

All public tables use Row Level Security.

Current default policy:

```text
anon/authenticated browser access = denied by default
server/admin access = allowed through safe server-side code
```

This prevents accidental exposure while the app is still moving from static dashboard to live dashboard.

## Next policy phase

When the app has login/auth, replace default-deny policies with owner/operator policies.

Example future direction:

```sql
create policy "Operators can view campaigns"
on public.campaigns
for select
to authenticated
using (true);
```

For production, use stricter rules based on `created_by`, roles, or admin claims.

## Data flow

```text
Instagram / WhatsApp / Manual Input
        ↓
Lead or Order
        ↓
Supabase Table
        ↓
Dashboard
        ↓
Weekly AI Brief
        ↓
Decision Log
        ↓
Next Campaign
```

## Operator rule

Do not connect public forms directly to write tables until policies are designed. For now, route writes through trusted server actions, admin tools, or protected authenticated flows.
