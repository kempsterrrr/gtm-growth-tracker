# GTM Growth Tracker

Dashboard for tracking open-source GitHub repos, npm packages, and Python packages to understand adoption trends across marketing, sales, engineering, and GTM teams.

## Features

- **GitHub Metrics**: Stars, forks, traffic (clones/views), contributors, releases
- **npm Downloads**: Daily download counts with historical backfill to 2015
- **PyPI Downloads**: Download stats by version and OS
- **Dependency Tracking**: Reverse dependencies via deps.dev API
- **Event Annotations**: Auto-detected releases and new dependents, plus manual events (blog posts, conferences, etc.)
- **Persona Views**: Toggle between Marketing, Sales, Engineering, and GTM perspectives
- **Time-series Charts**: Interactive charts with event annotation overlays

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

Data is collected via API calls to GitHub, npm, PyPI, and deps.dev. Run manually:

```bash
npm run collect
```

Or set up automated daily collection via the included GitHub Actions workflow (`.github/workflows/collect-daily.yml`). You'll need to add `GH_PAT` as a repository secret.

**Important**: GitHub traffic data expires after 14 days. Run the collector at least every 14 days to avoid losing traffic data permanently.

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 + shadcn/ui components
- Recharts for time-series charting
- SQLite (better-sqlite3) + Drizzle ORM
- GitHub Actions for scheduled data collection
