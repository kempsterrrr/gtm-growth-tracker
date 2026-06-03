CREATE TABLE `company_competitor_signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`package_id` integer NOT NULL,
	`signal_type` text DEFAULT 'depends_on' NOT NULL,
	`dependent_name` text NOT NULL,
	`first_seen` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`package_id`) REFERENCES `tracked_packages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "company_competitor_signals_type_check" CHECK("company_competitor_signals"."signal_type" IN ('depends_on'))
);
--> statement-breakpoint
CREATE INDEX `idx_company_competitor_signals_company` ON `company_competitor_signals` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `company_competitor_signals_unique` ON `company_competitor_signals` (`company_id`,`package_id`,`dependent_name`);