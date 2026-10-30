ALTER TABLE `mailSenders` ADD `mailboxKind` varchar(24);--> statement-breakpoint
ALTER TABLE `mailSenders` ADD `smtpHost` varchar(200);--> statement-breakpoint
ALTER TABLE `mailSenders` ADD `smtpPort` int;--> statement-breakpoint
ALTER TABLE `mailSenders` ADD `smtpSecure` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `mailSenders` ADD `smtpUser` varchar(320);--> statement-breakpoint
ALTER TABLE `mailSenders` ADD `smtpPassword` text;--> statement-breakpoint
ALTER TABLE `mailSenders` ADD `lastTestAt` timestamp;--> statement-breakpoint
ALTER TABLE `mailSenders` ADD `lastTestStatus` varchar(40);--> statement-breakpoint
ALTER TABLE `mailSenders` ADD `lastError` text;
