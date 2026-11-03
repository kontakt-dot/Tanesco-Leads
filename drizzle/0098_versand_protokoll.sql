CREATE TABLE `emailSendLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`campaignId` int NOT NULL,
	`recipientId` int,
	`leadId` int,
	`email` varchar(320) NOT NULL,
	`nodeId` varchar(40),
	`sender` varchar(320),
	`eventId` int,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emailSendLog_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_send_log_event_unique` UNIQUE(`eventId`)
);
--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `againAt` timestamp;--> statement-breakpoint
CREATE INDEX `email_send_log_day_idx` ON `emailSendLog` (`tenantId`,`sentAt`);--> statement-breakpoint
CREATE INDEX `email_send_log_campaign_idx` ON `emailSendLog` (`tenantId`,`campaignId`,`sentAt`);--> statement-breakpoint
CREATE INDEX `email_send_log_email_idx` ON `emailSendLog` (`tenantId`,`campaignId`,`email`);--> statement-breakpoint
INSERT IGNORE INTO `emailSendLog` (`tenantId`, `campaignId`, `recipientId`, `leadId`, `email`, `nodeId`, `sender`, `eventId`, `sentAt`) SELECT e.`tenantId`, e.`campaignId`, e.`recipientId`, r.`leadId`, LOWER(COALESCE(r.`email`, '')), e.`nodeId`, e.`sender`, e.`id`, e.`createdAt` FROM `emailCampaignEvents` e LEFT JOIN `emailCampaignRecipients` r ON r.`id` = e.`recipientId` WHERE e.`kind` = 'gesendet';
