CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`amount` text NOT NULL,
	`account_id` text NOT NULL,
	`destination_account_id` text,
	`category_id` text,
	`payee` text,
	`notes` text,
	`date` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_transactions_account_date` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_transactions_is_deleted` ON `transactions` (`is_deleted`);