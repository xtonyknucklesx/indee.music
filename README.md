# indee.music

The platform live music deserves.

Low-fee ticketing, smart booking tools, show archives, and a social network — built for independent venues, bands, labels, and the fans who keep it all alive.

## Project Structure

```
indee-music/
├── site/                    # Static site (Cloudflare Pages)
│   ├── index.html           # Landing page
│   └── survey/
│       └── index.html       # Discovery questionnaire
│
├── worker/                  # API backend (Cloudflare Worker + D1)
│   ├── src/
│   │   └── index.js         # Worker entry point
│   ├── schema.sql           # D1 database schema
│   ├── wrangler.toml        # Cloudflare Worker config
│   └── package.json         # Worker scripts
│
├── .gitignore
└── README.md
```

## Quick Start

### 1. Deploy the API Worker

```bash
cd worker

# Create the D1 database
npx wrangler d1 create questionnaire-db
# Copy the database_id into wrangler.toml

# Initialize the schema
npx wrangler d1 execute questionnaire-db --file=./schema.sql

# Set secrets
npx wrangler secret put ADMIN_TOKEN       # any random string for admin access
npx wrangler secret put IP_SALT           # any random string for IP hashing
npx wrangler secret put TURNSTILE_SECRET  # from Cloudflare Turnstile widget

# Deploy
npx wrangler deploy
# Note your Worker URL: https://questionnaire-api.<subdomain>.workers.dev
```

### 2. Create a Turnstile Widget

In Cloudflare dashboard → Turnstile → Add widget:
- Widget name: `indee.music`
- Domains: `indee.music`
- Widget mode: Managed
- Copy the **Site Key** into `site/index.html` and `site/survey/index.html` (replace `YOUR_TURNSTILE_SITE_KEY`)
- Copy the **Secret Key** and set it: `npx wrangler secret put TURNSTILE_SECRET`

### 3. Update URLs

In `site/index.html` and `site/survey/index.html`, replace:
- `YOUR_SUBDOMAIN` → your Cloudflare workers subdomain
- `YOUR_TURNSTILE_SITE_KEY` → your Turnstile site key

### 4. Deploy the Site

```bash
# From project root
npx wrangler pages project create indee-music
npx wrangler pages deploy site/ --project-name=indee-music
```

### 5. Connect Custom Domain

In the Cloudflare dashboard:
1. Go to Pages → indee-music → Custom domains
2. Add `indee.music`
3. Update DNS to point to Cloudflare Pages

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/submit` | None | Save a questionnaire or email signup |
| GET | `/api/responses?token=X` | Admin | All responses as JSON |
| GET | `/api/stats?token=X` | Admin | Summary stats |
| GET | `/api/export?token=X` | Admin | CSV export |

## Cost

$0 at current scale. D1 free tier covers 5M reads/day, Workers free tier covers 100K requests/day.

## License

Proprietary. All rights reserved.
