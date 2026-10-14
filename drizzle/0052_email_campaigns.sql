CREATE TABLE `emailCampaignEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`campaignId` int NOT NULL,
	`recipientId` int NOT NULL,
	`nodeId` varchar(40),
	`kind` enum('gesendet','geoeffnet','geklickt','gewartet','verzweigt','beendet','fehler','abgemeldet') NOT NULL,
	`subject` varchar(320),
	`note` varchar(400),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emailCampaignEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emailCampaignRecipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`campaignId` int NOT NULL,
	`leadId` int,
	`email` varchar(320) NOT NULL,
	`name` varchar(200),
	`company` varchar(200),
	`token` varchar(40) NOT NULL,
	`nodeId` varchar(40),
	`nextActionAt` timestamp,
	`status` enum('wartet','laeuft','fertig','fehler','abgemeldet') NOT NULL DEFAULT 'wartet',
	`sentCount` int NOT NULL DEFAULT 0,
	`lastSentAt` timestamp,
	`openedAt` timestamp,
	`clickedAt` timestamp,
	`repliedAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emailCampaignRecipients_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_recipients_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `emailCampaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` enum('entwurf','aktiv','pausiert','beendet') NOT NULL DEFAULT 'entwurf',
	`fromName` varchar(120),
	`fromEmail` varchar(320),
	`replyTo` varchar(320),
	`audience` json,
	`tree` json,
	`design` json,
	`startedAt` timestamp,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emailCampaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `company` varchar(200);--> statement-breakpoint
ALTER TABLE `leads` ADD `listName` varchar(160);--> statement-breakpoint
CREATE INDEX `email_events_campaign_idx` ON `emailCampaignEvents` (`tenantId`,`campaignId`);--> statement-breakpoint
CREATE INDEX `email_recipients_campaign_idx` ON `emailCampaignRecipients` (`tenantId`,`campaignId`);--> statement-breakpoint
CREATE INDEX `email_campaigns_tenant_idx` ON `emailCampaigns` (`tenantId`);