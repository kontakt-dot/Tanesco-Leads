ALTER TABLE `d2dReps` MODIFY COLUMN `subId` varchar(64);--> statement-breakpoint
ALTER TABLE `d2dAgencies` ADD `code` varchar(16);--> statement-breakpoint
ALTER TABLE `d2dAgencies` ADD `leaderUserId` int;--> statement-breakpoint
ALTER TABLE `d2dCaptures` ADD `salutation` enum('herr','frau');--> statement-breakpoint
ALTER TABLE `d2dCaptures` ADD `houseNumber` varchar(16);--> statement-breakpoint
ALTER TABLE `d2dCaptures` ADD `answers` json;--> statement-breakpoint
ALTER TABLE `d2dSettings` ADD `categoryId` int;--> statement-breakpoint
ALTER TABLE `d2dSettings` ADD `buyerUserId` int;--> statement-breakpoint
ALTER TABLE `d2dSettings` ADD `embedScriptUrl` text;