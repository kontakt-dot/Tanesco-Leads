CREATE TABLE `mailSenders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`fromName` varchar(120),
	`fromEmail` varchar(320) NOT NULL,
	`dailyLimit` int NOT NULL DEFAULT 40,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mailSenders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `emailCampaignEvents` ADD `sender` varchar(320);--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `warmupEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `warmupStartedAt` timestamp;--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `weeklyReportEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `weeklyReportAt` timestamp;--> statement-breakpoint
CREATE INDEX `mail_sender_tenant_idx` ON `mailSenders` (`tenantId`);