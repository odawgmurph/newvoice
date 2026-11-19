CREATE TABLE `journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`text` text NOT NULL,
	`mood` integer
);
--> statement-breakpoint
CREATE TABLE `recording` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`session_id` integer,
	`task_id` text NOT NULL,
	`local_uri` text,
	`features` text NOT NULL,
	`confidence` real,
	`analysis_version` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`duration_s` real,
	`warmup_done` integer DEFAULT false NOT NULL,
	`cooldown_done` integer DEFAULT false NOT NULL,
	`effort_rating` integer
);
--> statement-breakpoint
CREATE TABLE `skill_state` (
	`skill_id` text PRIMARY KEY NOT NULL,
	`mastery` real DEFAULT 0 NOT NULL,
	`half_life_days` real,
	`last_success_at` integer
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`goal` text,
	`goal_note` text,
	`environment` text,
	`language` text,
	`hormone_surgery_status` text,
	`slp_status` text,
	`playback_enabled` integer DEFAULT false NOT NULL,
	`metrics_only` integer DEFAULT true NOT NULL,
	`safety_primer_ack_at` integer,
	`onboarded_at` integer,
	`baseline_id` integer
);
