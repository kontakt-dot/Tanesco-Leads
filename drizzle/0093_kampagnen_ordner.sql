CREATE TABLE `emailCampaignFolders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emailCampaignFolders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `emailCampaigns` ADD `folderId` int;--> statement-breakpoint
CREATE INDEX `email_campaign_folders_tenant_idx` ON `emailCampaignFolders` (`tenantId`);