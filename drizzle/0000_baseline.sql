CREATE TABLE IF NOT EXISTS `alert_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`company_id` integer,
	`user_id` integer,
	`title` text NOT NULL,
	`detail` text,
	`metadata` text,
	`slack_sent` integer DEFAULT 0 NOT NULL,
	`acknowledged` integer DEFAULT 0 NOT NULL,
	`fired_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `github_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_alert_events_fired` ON `alert_events` (`fired_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`rule_type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`notify_slack` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "alert_rules_rule_type_check" CHECK("alert_rules"."rule_type" IN ('score_threshold', 'new_company', 'engagement_spike', 'new_enterprise_user'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `collection_cursors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cursor_type` text NOT NULL,
	`repo_id` integer NOT NULL,
	`cursor_value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `tracked_repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `collection_cursors_unique` ON `collection_cursors` (`cursor_type`,`repo_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`website` text,
	`industry` text,
	`employee_count` text,
	`funding_stage` text,
	`description` text,
	`logo_url` text,
	`apollo_id` text,
	`enriched_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `companies_domain_unique` ON `companies` (`domain`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `company_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`repo_id` integer,
	`date` text NOT NULL,
	`score` real NOT NULL,
	`user_count` integer NOT NULL,
	`star_count` integer DEFAULT 0 NOT NULL,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`pr_count` integer DEFAULT 0 NOT NULL,
	`commit_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repo_id`) REFERENCES `tracked_repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_company_scores_date` ON `company_scores` (`company_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `company_scores_unique` ON `company_scores` (`company_id`,`repo_id`,`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `enrichment_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_login` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "enrichment_queue_status_check" CHECK("enrichment_queue"."status" IN ('pending', 'processing', 'done', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `enrichment_queue_user_login_unique` ON `enrichment_queue` (`user_login`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_enrichment_queue_status` ON `enrichment_queue` (`status`,`priority`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`repo_id` integer,
	`package_id` integer,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `tracked_repos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`package_id`) REFERENCES `tracked_packages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_category_check" CHECK("events"."category" IN ('release', 'dependency_added', 'blog_post', 'conference', 'upstream_inclusion', 'custom')),
	CONSTRAINT "events_source_check" CHECK("events"."source" IN ('auto', 'manual'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_date` ON `events` (`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `github_engagement_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`event_date` text,
	`github_event_id` text,
	`metadata` text,
	`collected_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `tracked_repos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `github_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "github_engagement_events_event_type_check" CHECK("github_engagement_events"."event_type" IN ('star', 'fork', 'issue', 'pr', 'commit', 'issue_comment', 'pr_review'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_engagement_events_repo_user` ON `github_engagement_events` (`repo_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_engagement_events_user` ON `github_engagement_events` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `engagement_events_unique` ON `github_engagement_events` (`repo_id`,`user_id`,`event_type`,`github_event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `github_repo_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`date` text NOT NULL,
	`stars` integer,
	`forks` integer,
	`watchers` integer,
	`open_issues` integer,
	`contributors` integer,
	`collected_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `tracked_repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_github_repo_metrics_date` ON `github_repo_metrics` (`repo_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `github_repo_metrics_repo_date` ON `github_repo_metrics` (`repo_id`,`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `github_traffic_clones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`date` text NOT NULL,
	`clones_total` integer NOT NULL,
	`clones_unique` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `tracked_repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_github_traffic_clones_date` ON `github_traffic_clones` (`repo_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `github_traffic_clones_repo_date` ON `github_traffic_clones` (`repo_id`,`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `github_traffic_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`date` text NOT NULL,
	`views_total` integer NOT NULL,
	`views_unique` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `tracked_repos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_github_traffic_views_date` ON `github_traffic_views` (`repo_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `github_traffic_views_repo_date` ON `github_traffic_views` (`repo_id`,`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `github_user_companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`source` text NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `github_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "github_user_companies_source_check" CHECK("github_user_companies"."source" IN ('email_domain', 'profile_company', 'org_membership', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `github_user_companies_unique` ON `github_user_companies` (`user_id`,`company_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `github_user_emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`email` text NOT NULL,
	`domain` text NOT NULL,
	`source` text DEFAULT 'commit' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `github_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "github_user_emails_source_check" CHECK("github_user_emails"."source" IN ('commit', 'profile'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `github_user_emails_user_email` ON `github_user_emails` (`user_id`,`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `github_user_orgs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`org_login` text NOT NULL,
	`org_name` text,
	`org_description` text,
	`org_website` text,
	FOREIGN KEY (`user_id`) REFERENCES `github_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `github_user_orgs_user_org` ON `github_user_orgs` (`user_id`,`org_login`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `github_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`login` text NOT NULL,
	`github_id` integer,
	`name` text,
	`email` text,
	`company_raw` text,
	`bio` text,
	`blog` text,
	`avatar_url` text,
	`location` text,
	`twitter_username` text,
	`enriched_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `github_users_login_unique` ON `github_users` (`login`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `npm_downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`date` text NOT NULL,
	`downloads` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `tracked_packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_npm_downloads_date` ON `npm_downloads` (`package_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `npm_downloads_package_date` ON `npm_downloads` (`package_id`,`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pipeline_run_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`step_name` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pipeline_run_steps_status_check" CHECK("pipeline_run_steps"."status" IN ('success', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pipeline_run_steps_run` ON `pipeline_run_steps` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pipeline_run_steps_run_step` ON `pipeline_run_steps` (`run_id`,`step_name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pipeline_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	CONSTRAINT "pipeline_runs_status_check" CHECK("pipeline_runs"."status" IN ('running', 'success', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pypi_downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`date` text NOT NULL,
	`downloads` integer NOT NULL,
	`category` text DEFAULT 'overall' NOT NULL,
	`category_value` text,
	FOREIGN KEY (`package_id`) REFERENCES `tracked_packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pypi_downloads_date` ON `pypi_downloads` (`package_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pypi_downloads_package_date_cat` ON `pypi_downloads` (`package_id`,`date`,`category`,`category_value`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reverse_dependencies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`dependent_name` text NOT NULL,
	`dependent_registry` text NOT NULL,
	`dependent_version` text,
	`first_seen` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `tracked_packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `reverse_deps_package_dependent` ON `reverse_dependencies` (`package_id`,`dependent_name`,`dependent_registry`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reverse_dependency_counts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`date` text NOT NULL,
	`count` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `tracked_packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reverse_dep_counts_date` ON `reverse_dependency_counts` (`package_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `reverse_dep_counts_package_date` ON `reverse_dependency_counts` (`package_id`,`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `slack_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`webhook_url` text,
	`channel_name` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "slack_config_id_check" CHECK("slack_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tracked_packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`registry` text NOT NULL,
	`name` text NOT NULL,
	`repo_id` integer,
	`display_name` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `tracked_repos`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tracked_packages_registry_check" CHECK("tracked_packages"."registry" IN ('npm', 'pypi'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tracked_packages_registry_name` ON `tracked_packages` (`registry`,`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tracked_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tracked_repos_owner_name` ON `tracked_repos` (`owner`,`name`);