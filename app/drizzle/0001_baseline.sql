CREATE TABLE `baseline` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`session_id` integer,
	`summary` text,
	`analysis_version` text,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `recording` ADD `baseline_id` integer REFERENCES baseline(id) ON DELETE cascade;