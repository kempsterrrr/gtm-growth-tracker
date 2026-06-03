import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, unique, index, check } from "drizzle-orm/sqlite-core";

// This module is the SINGLE SOURCE OF TRUTH for the database schema — tables,
// indexes, UNIQUE and CHECK constraints, and DDL defaults. Migrations are
// generated from it with `npx drizzle-kit generate` (see src/lib/db/migrate.ts).

export const trackedRepos = sqliteTable(
  "tracked_repos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    competitor: text("competitor"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [unique("tracked_repos_owner_name").on(table.owner, table.name)]
);

export const trackedPackages = sqliteTable(
  "tracked_packages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    registry: text("registry", { enum: ["npm", "pypi"] }).notNull(),
    name: text("name").notNull(),
    repoId: integer("repo_id").references(() => trackedRepos.id),
    displayName: text("display_name"),
    competitor: text("competitor"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    unique("tracked_packages_registry_name").on(table.registry, table.name),
    check("tracked_packages_registry_check", sql`${table.registry} IN ('npm', 'pypi')`),
  ]
);

export const githubRepoMetrics = sqliteTable(
  "github_repo_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id")
      .notNull()
      .references(() => trackedRepos.id),
    date: text("date").notNull(),
    stars: integer("stars"),
    forks: integer("forks"),
    watchers: integer("watchers"),
    openIssues: integer("open_issues"),
    contributors: integer("contributors"),
    collectedAt: text("collected_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    unique("github_repo_metrics_repo_date").on(table.repoId, table.date),
    index("idx_github_repo_metrics_date").on(table.repoId, table.date),
  ]
);

export const githubTrafficClones = sqliteTable(
  "github_traffic_clones",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id")
      .notNull()
      .references(() => trackedRepos.id),
    date: text("date").notNull(),
    clonesTotal: integer("clones_total").notNull(),
    clonesUnique: integer("clones_unique").notNull(),
  },
  (table) => [
    unique("github_traffic_clones_repo_date").on(table.repoId, table.date),
    index("idx_github_traffic_clones_date").on(table.repoId, table.date),
  ]
);

export const githubTrafficViews = sqliteTable(
  "github_traffic_views",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id")
      .notNull()
      .references(() => trackedRepos.id),
    date: text("date").notNull(),
    viewsTotal: integer("views_total").notNull(),
    viewsUnique: integer("views_unique").notNull(),
  },
  (table) => [
    unique("github_traffic_views_repo_date").on(table.repoId, table.date),
    index("idx_github_traffic_views_date").on(table.repoId, table.date),
  ]
);

export const npmDownloads = sqliteTable(
  "npm_downloads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageId: integer("package_id")
      .notNull()
      .references(() => trackedPackages.id),
    date: text("date").notNull(),
    downloads: integer("downloads").notNull(),
  },
  (table) => [
    unique("npm_downloads_package_date").on(table.packageId, table.date),
    index("idx_npm_downloads_date").on(table.packageId, table.date),
  ]
);

export const pypiDownloads = sqliteTable(
  "pypi_downloads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageId: integer("package_id")
      .notNull()
      .references(() => trackedPackages.id),
    date: text("date").notNull(),
    downloads: integer("downloads").notNull(),
    category: text("category").notNull().default("overall"),
    categoryValue: text("category_value"),
  },
  (table) => [
    unique("pypi_downloads_package_date_cat").on(
      table.packageId,
      table.date,
      table.category,
      table.categoryValue
    ),
    index("idx_pypi_downloads_date").on(table.packageId, table.date),
  ]
);

export const reverseDependencies = sqliteTable(
  "reverse_dependencies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageId: integer("package_id")
      .notNull()
      .references(() => trackedPackages.id),
    dependentName: text("dependent_name").notNull(),
    dependentRegistry: text("dependent_registry").notNull(),
    dependentVersion: text("dependent_version"),
    firstSeen: text("first_seen").notNull(),
  },
  (table) => [
    unique("reverse_deps_package_dependent").on(
      table.packageId,
      table.dependentName,
      table.dependentRegistry
    ),
  ]
);

export const reverseDependencyCounts = sqliteTable(
  "reverse_dependency_counts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageId: integer("package_id")
      .notNull()
      .references(() => trackedPackages.id),
    date: text("date").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    unique("reverse_dep_counts_package_date").on(table.packageId, table.date),
    index("idx_reverse_dep_counts_date").on(table.packageId, table.date),
  ]
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category", {
      enum: [
        "release",
        "dependency_added",
        "blog_post",
        "conference",
        "upstream_inclusion",
        "custom",
      ],
    }).notNull(),
    source: text("source", { enum: ["auto", "manual"] })
      .notNull()
      .default("manual"),
    repoId: integer("repo_id").references(() => trackedRepos.id),
    packageId: integer("package_id").references(() => trackedPackages.id),
    metadata: text("metadata"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    check(
      "events_category_check",
      sql`${table.category} IN ('release', 'dependency_added', 'blog_post', 'conference', 'upstream_inclusion', 'custom')`
    ),
    check("events_source_check", sql`${table.source} IN ('auto', 'manual')`),
    index("idx_events_date").on(table.date),
  ]
);

// ── Sales Intelligence Tables ──────────────────────────────────────────

export const githubUsers = sqliteTable("github_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  login: text("login").notNull().unique(),
  githubId: integer("github_id"),
  name: text("name"),
  email: text("email"),
  companyRaw: text("company_raw"),
  bio: text("bio"),
  blog: text("blog"),
  avatarUrl: text("avatar_url"),
  location: text("location"),
  twitterUsername: text("twitter_username"),
  enrichedAt: text("enriched_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const githubUserEmails = sqliteTable(
  "github_user_emails",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => githubUsers.id),
    email: text("email").notNull(),
    domain: text("domain").notNull(),
    source: text("source", { enum: ["commit", "profile"] })
      .notNull()
      .default("commit"),
  },
  (table) => [
    unique("github_user_emails_user_email").on(table.userId, table.email),
    check("github_user_emails_source_check", sql`${table.source} IN ('commit', 'profile')`),
  ]
);

export const githubUserOrgs = sqliteTable(
  "github_user_orgs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => githubUsers.id),
    orgLogin: text("org_login").notNull(),
    orgName: text("org_name"),
    orgDescription: text("org_description"),
    orgWebsite: text("org_website"),
  },
  (table) => [unique("github_user_orgs_user_org").on(table.userId, table.orgLogin)]
);

export const githubEngagementEvents = sqliteTable(
  "github_engagement_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id")
      .notNull()
      .references(() => trackedRepos.id),
    userId: integer("user_id")
      .notNull()
      .references(() => githubUsers.id),
    eventType: text("event_type", {
      enum: ["star", "fork", "issue", "pr", "commit", "issue_comment", "pr_review"],
    }).notNull(),
    eventDate: text("event_date"),
    githubEventId: text("github_event_id"),
    metadata: text("metadata"),
    collectedAt: text("collected_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    unique("engagement_events_unique").on(
      table.repoId,
      table.userId,
      table.eventType,
      table.githubEventId
    ),
    check(
      "github_engagement_events_event_type_check",
      sql`${table.eventType} IN ('star', 'fork', 'issue', 'pr', 'commit', 'issue_comment', 'pr_review')`
    ),
    index("idx_engagement_events_repo_user").on(table.repoId, table.userId),
    index("idx_engagement_events_user").on(table.userId),
  ]
);

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  domain: text("domain").unique(),
  website: text("website"),
  industry: text("industry"),
  employeeCount: text("employee_count"),
  fundingStage: text("funding_stage"),
  description: text("description"),
  logoUrl: text("logo_url"),
  apolloId: text("apollo_id"),
  enrichedAt: text("enriched_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const githubUserCompanies = sqliteTable(
  "github_user_companies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => githubUsers.id),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    source: text("source", {
      enum: ["email_domain", "profile_company", "org_membership", "manual"],
    }).notNull(),
    confidence: real("confidence").notNull().default(0.5),
  },
  (table) => [
    unique("github_user_companies_unique").on(table.userId, table.companyId),
    check(
      "github_user_companies_source_check",
      sql`${table.source} IN ('email_domain', 'profile_company', 'org_membership', 'manual')`
    ),
  ]
);

export const companyScores = sqliteTable(
  "company_scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    repoId: integer("repo_id").references(() => trackedRepos.id),
    scope: text("scope", { enum: ["own", "competitor"] })
      .notNull()
      .default("own"),
    date: text("date").notNull(),
    score: real("score").notNull(),
    userCount: integer("user_count").notNull(),
    starCount: integer("star_count").notNull().default(0),
    forkCount: integer("fork_count").notNull().default(0),
    issueCount: integer("issue_count").notNull().default(0),
    prCount: integer("pr_count").notNull().default(0),
    commitCount: integer("commit_count").notNull().default(0),
  },
  (table) => [
    unique("company_scores_unique").on(table.companyId, table.repoId, table.date),
    index("idx_company_scores_date").on(table.companyId, table.date),
  ]
);

export const companyCompetitorSignals = sqliteTable(
  "company_competitor_signals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    packageId: integer("package_id")
      .notNull()
      .references(() => trackedPackages.id),
    signalType: text("signal_type", { enum: ["depends_on"] })
      .notNull()
      .default("depends_on"),
    dependentName: text("dependent_name").notNull(),
    firstSeen: text("first_seen").notNull(),
  },
  (table) => [
    unique("company_competitor_signals_unique").on(
      table.companyId,
      table.packageId,
      table.dependentName
    ),
    index("idx_company_competitor_signals_company").on(table.companyId),
    check("company_competitor_signals_type_check", sql`${table.signalType} IN ('depends_on')`),
  ]
);

export const alertRules = sqliteTable(
  "alert_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    ruleType: text("rule_type", {
      enum: ["score_threshold", "new_company", "engagement_spike", "new_enterprise_user"],
    }).notNull(),
    config: text("config").notNull(),
    enabled: integer("enabled").notNull().default(1),
    notifySlack: integer("notify_slack").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    check(
      "alert_rules_rule_type_check",
      sql`${table.ruleType} IN ('score_threshold', 'new_company', 'engagement_spike', 'new_enterprise_user')`
    ),
  ]
);

export const alertEvents = sqliteTable(
  "alert_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => alertRules.id),
    companyId: integer("company_id").references(() => companies.id),
    userId: integer("user_id").references(() => githubUsers.id),
    title: text("title").notNull(),
    detail: text("detail"),
    metadata: text("metadata"),
    slackSent: integer("slack_sent").notNull().default(0),
    acknowledged: integer("acknowledged").notNull().default(0),
    firedAt: text("fired_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_alert_events_fired").on(table.firedAt)]
);

export const slackConfig = sqliteTable(
  "slack_config",
  {
    id: integer("id").primaryKey().default(1),
    webhookUrl: text("webhook_url"),
    channelName: text("channel_name"),
    enabled: integer("enabled").notNull().default(0),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [check("slack_config_id_check", sql`${table.id} = 1`)]
);

export const enrichmentQueue = sqliteTable(
  "enrichment_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userLogin: text("user_login").notNull().unique(),
    priority: integer("priority").notNull().default(0),
    status: text("status", { enum: ["pending", "processing", "done", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    check(
      "enrichment_queue_status_check",
      sql`${table.status} IN ('pending', 'processing', 'done', 'failed')`
    ),
    index("idx_enrichment_queue_status").on(table.status, table.priority),
  ]
);

export const collectionCursors = sqliteTable(
  "collection_cursors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cursorType: text("cursor_type").notNull(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => trackedRepos.id),
    cursorValue: text("cursor_value").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [unique("collection_cursors_unique").on(table.cursorType, table.repoId)]
);

export const pipelineRuns = sqliteTable(
  "pipeline_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [
    check("pipeline_runs_status_check", sql`${table.status} IN ('running', 'success', 'failed')`),
  ]
);

export const pipelineRunSteps = sqliteTable(
  "pipeline_run_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => pipelineRuns.id),
    stepName: text("step_name").notNull(),
    status: text("status", { enum: ["success", "failed", "skipped"] }).notNull(),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at").notNull(),
  },
  (table) => [
    unique("pipeline_run_steps_run_step").on(table.runId, table.stepName),
    check(
      "pipeline_run_steps_status_check",
      sql`${table.status} IN ('success', 'failed', 'skipped')`
    ),
    index("idx_pipeline_run_steps_run").on(table.runId),
  ]
);
