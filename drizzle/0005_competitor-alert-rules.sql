PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`rule_type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`notify_slack` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "alert_rules_rule_type_check" CHECK("__new_alert_rules"."rule_type" IN ('score_threshold', 'new_company', 'engagement_spike', 'new_enterprise_user', 'new_prospect', 'battleground_shift', 'competitor_employee_engagement'))
);
--> statement-breakpoint
INSERT INTO `__new_alert_rules`("id", "name", "description", "rule_type", "config", "enabled", "notify_slack", "created_at") SELECT "id", "name", "description", "rule_type", "config", "enabled", "notify_slack", "created_at" FROM `alert_rules`;--> statement-breakpoint
DROP TABLE `alert_rules`;--> statement-breakpoint
ALTER TABLE `__new_alert_rules` RENAME TO `alert_rules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;