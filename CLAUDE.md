# CLAUDE.md

## Project Overview

**indee** (indee.music) is a live music platform for independent venues, bands, bookers, labels, and fans. Currently in pre-launch discovery phase — the site is a landing page + questionnaire collecting feedback from the live music community.

## Architecture

```
indee_music/
├── site/                          # Static site (Cloudflare Pages)
│   ├── index.html                 # Landing page with email capture
│   └── survey/
│       └── index.html             # 60-question discovery questionnaire
│
├── worker/                        # API backend (Cloudflare Worker + D1)
│   ├── src/
│   │   └── index.js               # Worker entry — submit, responses, stats, export
│   ├── schema.sql                 # D1 SQLite schema
│   ├── wrangler.toml              # Cloudflare Worker config
│   └── package.json               # npm scripts
│
├── .gitignore
├── CLAUDE.md                      # This file
└── README.md
```

## Tech Stack

- **Frontend**: Static HTML/CSS/JS (no framework, no build step)
- **Backend**: Cloudflare Worker (vanilla JS, ES modules)
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Hosting**: Cloudflare Pages
- **Bot Protection**: Cloudflare Turnstile
- **Payments (future)**: Stripe Connect
- **DNS/Domain**: indee.music via register.music (my.music Ltd registrar), nameservers on Cloudflare

## Key URLs

- **Production site**: https://indee.music
- **Survey**: https://indee.music/survey
- **Worker API**: https://questionnaire-api.anthony-rossi1983.workers.dev
- **GitHub repo**: https://github.com/xtonyknucklesx/indee.music (public)

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/submit` | Turnstile token | Save questionnaire or email signup |
| GET | `/api/responses?token=X` | Admin token | All responses as JSON |
| GET | `/api/stats?token=X` | Admin token | Summary stats |
| GET | `/api/export?token=X` | Admin token | CSV export |

## Secrets (set via `wrangler secret put`, never committed)

- `ADMIN_TOKEN` — authenticates admin API endpoints
- `IP_SALT` — salt for hashing IP addresses
- `TURNSTILE_SECRET` — Cloudflare Turnstile server-side verification

## Database Schema

Single table `responses` in D1:
- `id` INTEGER PRIMARY KEY
- `roles` TEXT — comma-separated roles (venue, booker, band, label, fan, email_signup)
- `name` TEXT — from q01
- `city` TEXT — from q03
- `answers` TEXT — JSON blob of all answers
- `submitted_at` TEXT — ISO timestamp
- `ip_hash` TEXT — truncated SHA-256 of IP + salt

## Development

### Local Worker dev
```bash
cd worker
npx wrangler dev
```

### Deploy Worker
```bash
cd worker
npx wrangler deploy
```

### Deploy site
```bash
npx wrangler pages deploy site/ --project-name=indee-music
```

### Run D1 migrations
```bash
cd worker
npx wrangler d1 execute questionnaire-db --remote --file=./schema.sql
```

## Git Conventions

- All commits must be GPG signed (`commit.gpgsign = true`)
- Branch protection on `main`: signed commits required, no force pushes, no deletions, linear history enforced, admin enforcement enabled
- To push changes that require temporarily lifting protection, use `gh api -X DELETE` to remove protection, push, then re-enable

## Design Decisions

- **No framework on purpose**: The site is two static HTML files. No React, no build step, no node_modules. Keep it that way until there's a real reason to add complexity.
- **Single D1 table with JSON answers**: Different roles answer different questions. Flexible JSON blob avoids schema migrations during discovery phase. Can normalize later.
- **Turnstile on all submissions**: Bot protection on both email signups and questionnaire submissions. Worker verifies server-side.
- **CORS open (`*`)**: The Worker accepts requests from any origin. Fine for now since it's a public form. Lock down to `indee.music` when the platform goes into production.

## Brand Guidelines

- The brand name is **indee** — always lowercase
- The domain is **indee.music**
- Color palette: dark theme, accent red `#E84855`, muted `#7A7A72`, white `#F5F5F0`
- Fonts: Space Mono (monospace/headings), DM Sans (body), Instrument Serif (hero display)
- Tone: DIY, punk ethos, anti-corporate, direct, no bullshit

## Future Platform Features (documented, not yet built)

- Low-fee ticketing (tiered SaaS + $0.50 buyer fee via Stripe Connect)
- Automated settlement with audit trails and change controls
- Social profiles for bands, venues, bookers, labels, fans
- Real-time fill-a-slot booking marketplace
- Show video archive with multi-angle fan video sync
- Tour companion with crowdsourced stop recommendations
- Flash drops and exclusive content with engagement-tiered notifications
- Fan concert timeline / show history
- Integrated merch storefront
- Label dashboard with A&R discovery engine
- .MUSIC identity integration (potential partnership with my.music Ltd)

## Owner

Tony Rossi — Poulsbo, WA
GitHub: xtonyknucklesx