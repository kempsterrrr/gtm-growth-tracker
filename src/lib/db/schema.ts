import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const trackedRepos = sqliteTable(
  "tracked_repos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("tracked_repos_owner_name").on(table.owner, table.name)]
);

export const trackedPackages = sqliteTable(
  "tracked_packages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    registry: text("registry", { enum: ["npm", "pypi"] }).notNull(),
    name: text("name").notNull(),
    repoId: integer("repo_id").references(() => trackedRepos.id),
    displayName: text("display_name"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("tracked_packages_registry_name").on(table.registry, table.name)]
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
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("github_repo_metrics_repo_date").on(table.repoId, table.date)]
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
  (table) => [uniqueIndex("github_traffic_clones_repo_date").on(table.repoId, table.date)]
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
  (table) => [uniqueIndex("github_traffic_views_repo_date").on(table.repoId, table.date)]
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
  (table) => [uniqueIndex("npm_downloads_package_date").on(table.packageId, table.date)]
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
    uniqueIndex("pypi_downloads_package_date_cat").on(
      table.packageId,
      table.date,
      table.category,
      table.categoryValue
    ),
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
    uniqueIndex("reverse_deps_package_dependent").on(
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
  (table) => [uniqueIndex("reverse_dep_counts_package_date").on(table.packageId, table.date)]
);

export const events = sqliteTable("events", {
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
    .$defaultFn(() => new Date().toISOString()),
});
