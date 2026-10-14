ALTER TABLE `emailSuppressions` MODIFY COLUMN `reason` enum('bounce','beschwerde','abgemeldet','gesperrt','manuell') NOT NULL;--> statement-breakpoint
ALTER TABLE `emailSuppressions` ADD `source` varchar(160);--> statement-breakpoint
ALTER TABLE `inboxMessages` ADD `blocked` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `inboxMessages` ADD `optOut` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `kind` enum('verkauf','vertrieb') DEFAULT 'verkauf' NOT NULL;--> statement-breakpoint
CREATE INDEX `lead_tenant_kind_idx` ON `leads` (`tenantId`,`kind`);--> statement-breakpoint
UPDATE `leads` SET `kind` = 'vertrieb' WHERE `pipelineStage` IS NOT NULL OR `adPlatform` IS NOT NULL OR `adCampaignId` IS NOT NULL;
