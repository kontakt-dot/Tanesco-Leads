ALTER TABLE `pipelineNotes` MODIFY COLUMN `source` enum('text','sprache','gespraech') NOT NULL DEFAULT 'text';--> statement-breakpoint
ALTER TABLE `dialerCalls` ADD `autoNotes` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `dialerCalls` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `dialerCalls` ADD `summarySource` varchar(20);--> statement-breakpoint
ALTER TABLE `dialerCalls` ADD `summaryAt` timestamp;--> statement-breakpoint
ALTER TABLE `dialerCampaigns` ADD `autoNotes` boolean;--> statement-breakpoint
ALTER TABLE `pipelineNotes` ADD `dialerCallId` int;--> statement-breakpoint
ALTER TABLE `telephonySettings` ADD `autoCallNotes` boolean DEFAULT true NOT NULL;