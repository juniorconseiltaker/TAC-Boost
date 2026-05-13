CREATE TABLE IF NOT EXISTS `answer_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`text` text NOT NULL,
	`is_correct` integer DEFAULT 0 NOT NULL,
	`rationale` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`question_text` text NOT NULL,
	`success_count` integer DEFAULT 0,
	`failure_count` integer DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`exam_mode` text NOT NULL,
	`score` integer NOT NULL,
	`total_questions` integer NOT NULL,
	`correct_answers` integer NOT NULL,
	`time_spent` integer NOT NULL,
	`category_scores` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_scores_user` ON `scores` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_scores_mode` ON `scores` (`exam_mode`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_scores_score` ON `scores` (`score`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_scores_created` ON `scores` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `test_session_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP,
	`current_question_index` integer DEFAULT 0 NOT NULL,
	`progress_updated_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `test_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `test_session_participants_session_id_user_id_unique` ON `test_session_participants` (`session_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_session_participants_session` ON `test_session_participants` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_session_participants_user` ON `test_session_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `test_session_result_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`question_id` integer NOT NULL,
	`is_correct` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `test_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_session_answers_session` ON `test_session_result_answers` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_session_answers_user` ON `test_session_result_answers` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_session_answers_question` ON `test_session_result_answers` (`question_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `test_session_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`score` integer NOT NULL,
	`total_questions` integer NOT NULL,
	`correct_answers` integer NOT NULL,
	`time_spent` integer NOT NULL,
	`category_scores` text,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`session_id`) REFERENCES `test_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `test_session_results_session_id_user_id_unique` ON `test_session_results` (`session_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_session_results_session` ON `test_session_results` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_session_results_user` ON `test_session_results` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `test_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pin` text NOT NULL,
	`created_by` text NOT NULL,
	`exam_mode` text NOT NULL,
	`custom_categories` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`question_count` integer NOT NULL,
	`time_limit_seconds` integer NOT NULL,
	`quiz_payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`started_at` text,
	`ended_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `test_sessions_pin_unique` ON `test_sessions` (`pin`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_sessions_pin` ON `test_sessions` (`pin`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_sessions_status` ON `test_sessions` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_sessions_created_by` ON `test_sessions` (`created_by`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_test_sessions_created_at` ON `test_sessions` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_roles` (
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`role` text DEFAULT 'user',
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);--> statement-breakpoint
INSERT OR IGNORE INTO `categories` (`name`, `slug`) VALUES
	('Mouvement', 'mouvement'),
	('CLR', 'clr'),
	('Organisationnel', 'organisationnel'),
	('Trésorerie', 'tresorerie'),
	('Pilotage', 'pilotage'),
	('Suivi d''Études', 'suivi-etudes');
