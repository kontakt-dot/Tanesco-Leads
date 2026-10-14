CREATE TABLE `adInsights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`day` varchar(10) NOT NULL,
	`campaignId` varchar(64) NOT NULL,
	`campaignName` varchar(240),
	`adsetId` varchar(64),
	`adsetName` varchar(240),
	`adId` varchar(64),
	`adName` varchar(240),
	`objective` varchar(80),
	`status` varchar(40),
	`dailyBudget` decimal(10,2),
	`spend` decimal(10,2) NOT NULL DEFAULT '0.00',
	`impressions` int NOT NULL DEFAULT 0,
	`clicks` int NOT NULL DEFAULT 0,
	`results` int NOT NULL DEFAULT 0,
	`syncedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `adInsights_id` PRIMARY KEY(`id`),
	CONSTRAINT `ad_insights_unique` UNIQUE(`tenantId`,`day`,`campaignId`,`adsetId`,`adId`)
);
--> statement-breakpoint
CREATE TABLE `metaConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`pageId` varchar(64),
	`pageName` varchar(200),
	`pageAccessToken` text,
	`userAccessToken` text,
	`tokenExpiresAt` timestamp,
	`adAccountId` varchar(64),
	`adAccountName` varchar(200),
	`verifyToken` varchar(80) NOT NULL,
	`webhookSubscribed` boolean NOT NULL DEFAULT false,
	`formMappings` json,
	`status` enum('nicht_verbunden','verbunden','fehler') NOT NULL DEFAULT 'nicht_verbunden',
	`lastLeadAt` timestamp,
	`lastSyncAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `metaConnections_id` PRIMARY KEY(`id`),
	CONSTRAINT `meta_connections_tenant_unique` UNIQUE(`tenantId`)
);
--> statement-breakpoint
CREATE TABLE `pipelineEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`fromStage` varchar(40),
	`toStage` varchar(40) NOT NULL,
	`actorUserId` int,
	`note` varchar(400),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pipelineEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `pipelineStage` varchar(40);--> statement-breakpoint
ALTER TABLE `leads` ADD `pipelineUpdatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `adCampaignId` varchar(64);--> statement-breakpoint
ALTER TABLE `leads` ADD `adCampaignName` varchar(240);--> statement-breakpoint
ALTER TABLE `leads` ADD `adsetName` varchar(240);--> statement-breakpoint
ALTER TABLE `leads` ADD `adName` varchar(240);--> statement-breakpoint
ALTER TABLE `leads` ADD `adFormName` varchar(240);--> statement-breakpoint
ALTER TABLE `leads` ADD `adPlatform` varchar(24);--> statement-breakpoint
ALTER TABLE `leads` ADD `leadgenId` varchar(64);--> statement-breakpoint
CREATE INDEX `ad_insights_tenant_day_idx` ON `adInsights` (`tenantId`,`day`);--> statement-breakpoint
CREATE INDEX `pipeline_events_lead_idx` ON `pipelineEvents` (`tenantId`,`leadId`);