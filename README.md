# SDR Renovation PM

**Live app:** https://rwalker0807.github.io/sdr-renovation-pm/ (sign in with an @sdandr.com email)

A hosted, live-updating tracker for every SDR renovation project: budget, cost, invoices, onsite progress, scope gaps, buyout, subcontracts, material buys, specs and scopes. One database serves all projects; switch between them from the sidebar.

## How it's built

| Layer | Choice | Why |
|---|---|---|
| Database | **Supabase** (hosted Postgres) | Real SQL database, free tier to start, built-in login, and it pushes every change to open browsers over websockets |
| App | **React + TypeScript (Vite)** | Builds to static files, so you can host it anywhere for free or close to it |
| Hosting | **Vercel, Netlify, or Azure Static Web Apps** | Drag-and-drop or connect a GitHub repo |
| Login | Supabase magic-link email | No passwords to manage; restrict to @sdandr.com later |

**Live updates:** when anyone saves a change (field super updates progress, PM approves an invoice), Postgres sends the change to every open browser and the row flashes. Nobody has to refresh.

**Demo mode:** if no database keys are set, the app runs on built-in sample data in the browser. Open two windows and the "Simulate field update" button on Onsite Progress shows the live sync.

## Modules

- **Dashboard**: contract value, committed %, projected over/under, invoiced/paid, % complete, % bought out, open scope gaps, and a "Needs attention" list (late buyout awards, materials due inside 14 days, invoices waiting on approval or disputed, COIs expiring, executed contracts without a COI, blocked field items, open gaps)
- **Budget & Cost**: cost-code rollup (Original → Owner COs → Revised → Committed → Unbought → Exposure → Projected → Over/Under → Invoiced → Paid). Click a line to see its commitments, COs, materials, invoices and gaps
- **Change Orders**: owner COs (move the budget) and sub COs (move the cost)
- **Invoices**: pay apps and supplier invoices with retainage and status
- **Buyout**: kanban from Not Started to Contracted, with buyout savings/overrun per package
- **Subcontracts & POs**: commitments, retainage %, execution and COI status
- **Material Buys**: qty × unit cost, PO, need-by and delivery tracking
- **Onsite Progress**: building × activity heat map; click a cell to update; blocked items flagged
- **Scope Gaps**: what falls between two trades, estimated cost, owner, resolution
- **Scopes of Work / Specs**: inclusions/exclusions per trade, CSI spec sections with basis of design
- **Vendors & Subs / All Projects**: shared directories

### Rollup math (`src/lib/rollups.ts`, same as SQL view `budget_rollup`)
- **Committed** = subcontracts/POs not in draft + approved sub COs + material buys past "quoted"
- **Unbought** = budget of buyout packages not yet awarded (lines with no packages forecast their remaining budget)
- **Exposure** = pending sub COs + unresolved scope gaps
- **Projected** = Committed + Unbought + Exposure. **Over/Under** = Revised budget − Projected

## Run it on a computer

Needs Node.js 18+ (`node -v` to check).

```bash
npm install
npm run dev          # opens http://localhost:5173 in demo mode
```

## Database status

- Supabase project `jmvbtzlicsfzqfztdbwu` (us-east-1). Schema from `supabase/migrations/0001_init.sql` is applied.
- **Access:** only signed-in users whose email ends in **@sdandr.com** can read or change data. Anonymous visitors and other emails get nothing back (tested).
- **Sample data loaded:** "Maple Court Apartments (sample)" and "Oak Terrace Townhomes (sample)" plus 12 sample vendors. To remove them before going live, run in the SQL editor:
  ```sql
  delete from projects where code like 'DEMO-%';
  delete from vendors where id::text like '00000000-0000-4000-8000-%';
  ```
- `.env.production` holds the project URL and the *publishable* key. That key is public by design; the security comes from the row-level policies. Never commit the secret / service_role key.

### Supabase settings to finish in the dashboard
1. ✅ **Authentication → URL Configuration:** Site URL and Redirect URLs are set to the GitHub Pages address and `http://localhost:5173`.
2. **Authentication → Emails → SMTP:** Supabase's built-in email sender only allows a few sign-in emails per hour. Before rolling out to the team, plug in SMTP (Microsoft 365, SendGrid, Resend, etc.).
3. Optional: **Authentication → Sign In / Providers →** turn off "Allow new users to sign up" and invite people from **Users**, for a hard invite-only list.

## Run it on a computer

```bash
npm install
npm run dev                 # http://localhost:5173, uses the live database (.env.local / .env.production)
npm run dev -- --mode demo  # same app on in-browser sample data
```

## Host it

- **GitHub Pages (live):** `.github/workflows/deploy.yml` builds and publishes on every push to `main`, usually in under a minute. Repo: https://github.com/rwalker0807/sdr-renovation-pm
- **Vercel or Netlify (free, works with private repos):** import the GitHub repo. Build command `npm run build`, output folder `dist`. No environment variables needed since `.env.production` is committed.
- **Azure Static Web Apps** works the same way if you'd rather keep it in the Microsoft 365 tenant.
- `npm run build:demo` makes one self-contained `dist-demo/index.html` running on sample data, useful for showing people.

## Getting data in and out

- **Export:** every table has a **⤓ Excel** button (exports the rows on screen). Budget has its own export, and the Dashboard has **⤓ Project workbook** (every tracker for the job in one file).
- **Import:** drop files in `SDR Ops\Renovation PM App\_import`. The scheduled task **Weekly tracker import** (Mondays 6:55 AM ET, needs Ryan's computer on) loads them using the rules in `_import\IMPORT-PROCEDURE.md`, moves them to `_import\processed\<date>\` and writes an import summary. Ask Claude to "run the tracker import" any time to do it on demand.
- **Who owns what:** the website owns progress, buyout, subcontracts, scope gaps, specs and scopes (edit them on the site). QuickBooks owns cost and bills; Outlook (Paige's email sweep) owns change orders and open items. Imports never overwrite website-owned data and never delete rows.

## Project layout

```
supabase/migrations/0001_init.sql   tables, realtime, row-level security, budget_rollup view
scripts/seed.ts / seed-sql.ts       load sample data into Supabase (API or SQL)
src/lib/schema.ts                   every table's fields: drives forms, tables, totals
src/lib/data/                       data adapters (supabase = live, demo = in-browser) + sample data
src/lib/store.tsx                   loads a project, applies realtime changes in place
src/lib/rollups.ts                  budget, buyout, progress and "needs attention" logic
src/views/views.tsx                 Dashboard, Budget, Buyout board, Progress matrix, generic module page
src/components/                     DataTable, RecordDrawer (add/edit form), UI bits
```

**Adding a field:** add the column in SQL, then one line in `src/lib/schema.ts`. The form, table, search and totals pick it up automatically.

## Suggested next steps

1. **Roles and permissions:** `project_members` table (PM, super, accounting, owner rep, read-only) and tighter RLS policies, e.g. supers update progress but not budgets
2. **File attachments:** Supabase Storage buckets for invoices, executed contracts, COIs and spec PDFs (fields already exist as URLs)
3. **Imports:** CSV/Excel import for budgets (Xactimate or estimate exports) and the vendor list
4. **Field mode:** phone-first progress screen with photos and unit-level tracking (`progress.unit` already exists)
5. **Pay-app workflow:** schedule of values per subcontract, % complete billing, retainage release
6. **Integrations:** Encircle (field docs), QuickBooks (invoices/payments), Outlook (invoice inbox → draft invoice rows), Smartsheet/Trello export
7. **History:** audit-log table (who changed what, when) via a Postgres trigger
8. **Reporting:** monthly cost report PDF, plus Power BI/Excel connected straight to the `budget_rollup` view
