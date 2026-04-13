# ar.io Growth Tracker

Dashboard for tracking open-source GitHub repos, npm packages, and Python packages to understand adoption trends — with built-in sales intelligence that detects which companies are engaging with your tools.

## Features

### Metrics & Trends
- **GitHub Metrics**: Stars, forks, traffic (clones/views), contributors, releases
- **npm Downloads**: Daily download counts with historical backfill to 2015
- **PyPI Downloads**: Download stats by version and OS
- **Dependency Tracking**: Reverse dependencies via deps.dev API
- **Event Annotations**: Auto-detected releases and new dependents, plus manual events (blog posts, conferences, etc.)
- **Persona Views**: Toggle between Marketing, Sales, Engineering, and GTM perspectives

### Sales Intelligence
- **Company Detection**: Identifies companies from commit emails, GitHub profile fields, and org memberships
- **Engagement Scoring**: Ranks companies by depth (star=1, fork=2, issue=3, PR=5, commit=10) and breadth (distinct users)
- **Companies Dashboard**: Leaderboard with score breakdown, trend tracking, and drill-down to individual users
- **Configurable Alerts**: Score thresholds, engagement spikes, enterprise domain watchlists
- **Slack Notifications**: Push sales signals to a Slack channel via incoming webhook

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your GITHUB_TOKEN

# Initialize the database
npm run db:migrate

# Configure packages to track (edit gtm-config.yaml)
# Then run the collector
npm run collect

# Backfill npm historical data
npm run db:seed

# Start the dev server
npm run dev
```

Open http://localhost:3000 to view the dashboard.

## GitHub Token

You need a GitHub Fine-grained Personal Access Token. Go to github.com/settings/tokens and create one with:

| Permission | Level | What it enables |
|---|---|---|
| **Metadata** | Read | Required (default) |
| **Contents** | Read | Releases, commits, contributor stats |
| **Administration** | Read | Traffic data (clones + views) |

Without Administration permission, everything works except traffic charts.

## Configuration

Edit `gtm-config.yaml` to configure which repos and packages to track:

```yaml
github:
  repos:
    - owner: "your-org"
      name: "your-repo"
      display_name: "My Repo"

packages:
  npm:
    - name: "your-package"
      display_name: "My Package"
  pypi:
    - name: "your-python-package"

collection:
  npm_backfill_from: "2024-01-01"
```

Or use the Settings page in the dashboard UI.

## Data Collection

The collector runs a 12-step pipeline: GitHub metrics, npm downloads, PyPI downloads, dependencies, auto-events, engagement tracking, user enrichment, commit email extraction, company resolution, scoring, alert evaluation, and Slack notifications.

```bash
npm run collect
```

Or set up automated daily collection via the included GitHub Actions workflow (`.github/workflows/collect-daily.yml`). Add `GH_PAT` as a repository secret.

**Important**: GitHub traffic data expires after 14 days. Run the collector at least every 14 days to avoid losing traffic data permanently.

## Slack Alerts

Configure Slack notifications in the Settings page or set `SLACK_WEBHOOK_URL` in your environment. Default alert rules (auto-seeded):

1. **High-engagement company** — Fires when a company scores ≥ 15 with ≥ 2 users
2. **Engagement spike** — Fires when a company's score doubles in 7 days

Create custom rules in the Alerts page for enterprise domain watchlists, score thresholds, etc.

## Deployment

### Railway

The repo includes a `Dockerfile` and `railway.toml` for Railway deployment. A GitHub Actions workflow (`.github/workflows/deploy-railway.yml`) auto-deploys on merge to main.

1. Create a Railway project linked to your repo
2. Add `RAILWAY_TOKEN` as a GitHub repo secret
3. Set env vars in Railway: `GITHUB_TOKEN`, `DATABASE_PATH=/app/data/gtm-tracker.db`

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 + shadcn/ui components
- Recharts for time-series charting
- SQLite (better-sqlite3) + Drizzle ORM
- ar.io brand: Besley headlines, Plus Jakarta Sans body, #5427C8 primary purple
- GitHub Actions for scheduled data collection and Railway deployment
