CREATE TABLE `attempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`session_id` integer,
	`lesson_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`refresher` integer DEFAULT false NOT NULL,
	`passed` integer NOT NULL,
	`outcome` text NOT NULL,
	`evidence` text,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `rest_day` (
	`day` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `symptom_report` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`symptoms` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `journal` ADD `prompt` text;--> statement-breakpoint
ALTER TABLE `journal` ADD `lesson_id` text;--> statement-breakpoint
ALTER TABLE `session` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `session` ADD `voiced_s` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `listen_trials` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `lessons_done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `skill_state` ADD `weights` text;--> statement-breakpoint
ALTER TABLE `skill_state` ADD `successes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `skill_state` ADD `failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `skill_state` ADD `level` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `track` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `quiet_mode` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `whisper_mode` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `shake_to_exit` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `progress_timeline` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `developer_tools` integer DEFAULT false NOT NULL;