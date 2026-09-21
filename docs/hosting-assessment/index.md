# Hosting assessment — Lovable vs the actual Debtrecover architecture

Assessed 2026-09-21. Verified against Lovable's and the platforms' own documentation, not assumed.

## What Debtrecover needs from a host

| Requirement | Why |
| --- | --- |
| Next.js 16 App Router (Server Components, Server Actions) | the whole application |
| Node.js server runtime | Server Actions perform authenticated Supabase calls and sends |
| Outbound TCP to Gmail SMTP (465) with Nodemailer | initial-reminder email (`src/adapters/gmail-smtp.ts`) |
| Server-only secrets (`AISENSY_API_KEY`, `SMTP_APP_PASSWORD`) | never in the client bundle |
| Outbound HTTPS to AiSensy and Supabase | WhatsApp sends, data |
| Custom domain `debtor.nklodha.in`, automatic HTTPS | production URL |
| Deploy from GitHub (`main`) | release workflow |

## Verdict: Lovable cannot host this application

* **Wrong framework/runtime.** Lovable's current stack is TanStack Start running on Cloudflare Workers (its own announcement:
  "Runtime: Cloudflare Workers", replacing static Cloudflare Pages hosting). It does not build or run Next.js. Server code is written as
  TanStack `createServerFn` functions, not Next.js Server Actions / Server Components.
  Source: <https://lovable.dev/blog/building-apps-using-tanstack-start>
* **No way to import an existing repo.** Lovable's GitHub integration is export / two-way sync of *Lovable-created* projects only:
  "Importing existing GitHub repositories into Lovable. You can only export from Lovable to GitHub."
  Source: <https://docs.lovable.dev/integrations/github>
* **Outbound SMTP is not a supported pattern on Workers/edge runtimes.** Nodemailer needs raw Node TCP sockets. Lovable's own backend
  functions run on Supabase/Deno-style edge runtimes, where outbound ports 25/587 are blocked and 465 is undocumented/unreliable
  (Supabase docs and issues: <https://supabase.com/docs/guides/functions/limits>, <https://github.com/supabase/supabase/issues/6255>).
* Custom domains work on Lovable (<https://docs.lovable.dev/features/custom-domain>), but that is moot given the above.

Rewriting to TanStack Start, replacing Nodemailer with an HTTP mail API, and re-implementing every Server Action would be a new
development phase, not a deployment step. **Do not use Lovable for V1.**

## Minimum production hosting change: Vercel (Pro) — or the documented self-hosted Node server

| Requirement | Vercel (Next.js native) |
| --- | --- |
| Next.js 16 App Router / Server Actions | native (Next.js is Vercel's framework) |
| Node runtime | yes (Node serverless functions) |
| SMTP | port 25 blocked; **465 and 587 open** (Debtrecover uses 465). Sends are fully `await`ed inside the Server Action, so the connection completes before the function returns. Source: <https://vercel.com/kb/guide/serverless-functions-and-smtp> |
| Server-only secrets | project environment variables (never `NEXT_PUBLIC_*`) |
| Custom domain + HTTPS | automatic certificate; `CNAME debtor -> cname.vercel-dns.com` (or the exact value Vercel shows) |
| GitHub deploy | Git integration on `main` |
| Region | `vercel.json` pins `syd1`, next to the Sydney Supabase project (many small queries per page) |

Notes: Vercel Hobby is non-commercial; a business deployment needs **Pro**. If a serverless SMTP problem ever appears, the fallback is
an HTTP mail API (outside V1 scope) or the self-hosted alternative already documented in `docs/DEPLOYMENT.md` (Node + nginx + systemd).

## Go-live checklist (human steps marked ✋)

1. ✋ Create/sign in to the Vercel account (Pro), import `accounts-NKlodha/claude-debtor-recovery-app`, branch `main`.
2. Set production environment variables (values from `.env.local`; never commit): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL=https://debtor.nklodha.in`, `SMTP_HOST/PORT/USER/APP_PASSWORD/FROM_ADDRESS/FROM_NAME`,
   `WHATSAPP_PROVIDER=aisensy`, `AISENSY_API_KEY`, the five `AISENSY_CAMPAIGN_..._V2` names, `ADAPTER_PROFILE=live`, `DATA_PROFILE=supabase`.
   Do **not** set `SUPABASE_SERVICE_ROLE_KEY` (the app does not need it).
3. ✋ Add the DNS record for `debtor.nklodha.in` at the `nklodha.in` DNS provider.
4. ✋ Supabase → Authentication → Sign In / Providers: turn **off** "Allow new users to sign up". Add `https://debtor.nklodha.in` as Site URL / redirect URL.
5. Deploy; verify HTTPS, `/` redirects to sign-in, role gates, core pages; **no** sends during the smoke test.
