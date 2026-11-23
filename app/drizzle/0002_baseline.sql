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
ALTER TABLE `recording` ADD `baseline_id` integer REFERENCES baseline(id) ON DELETE cascade;--> statement-breakpoint
INSERT INTO `baseline` (`created_at`, `completed_at`, `summary`, `analysis_version`)
  SELECT r.`created_at`, r.`created_at`, r.`features`, r.`analysis_version` FROM `recording` r
  JOIN `user` u ON u.`baseline_id` = r.`id` WHERE r.`task_id` = 'baseline.provisional';--> statement-breakpoint
UPDATE `recording` SET `baseline_id` = (SELECT max(`id`) FROM `baseline`)
  WHERE `id` = (SELECT `baseline_id` FROM `user` WHERE `id` = 1) AND `task_id` = 'baseline.provisional';--> statement-breakpoint
UPDATE `user` SET `baseline_id` = (SELECT max(`id`) FROM `baseline`)
  WHERE `baseline_id` IN (SELECT `id` FROM `recording` WHERE `task_id` = 'baseline.provisional');