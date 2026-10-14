CREATE TABLE `emailSuppressions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`reason` enum('bounce','beschwerde','abgemeldet','manuell') NOT NULL,
	`note` varchar(400),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emailSuppressions_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_suppressions_unique` UNIQUE(`tenantId`,`email`)
);
--> statement-breakpoint
CREATE TABLE `outboundMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`channel` enum('sms','whatsapp','email') NOT NULL,
	`toAddress` varchar(320) NOT NULL,
	`subject` varchar(320),
	`text` text NOT NULL,
	`templateKey` varchar(60),
	`status` enum('gesendet','simuliert','fehlgeschlagen','link') NOT NULL,
	`provider` varchar(40),
	`providerSid` varchar(80),
	`error` varchar(400),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `outboundMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipelineSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`settings` json NOT NULL,
	`distributionCursor` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pipelineSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `pipeline_settings_tenant_unique` UNIQUE(`tenantId`)
);
--> statement-breakpoint
CREATE TABLE `pipelineTasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`ownerUserId` int,
	`kind` enum('anruf','email','termin','aufgabe','sms','whatsapp') NOT NULL DEFAULT 'anruf',
	`title` varchar(200) NOT NULL,
	`note` varchar(600),
	`dueAt` timestamp NOT NULL,
	`doneAt` timestamp,
	`source` enum('manuell','dialer','notiz','automatik','termin') NOT NULL DEFAULT 'manuell',
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pipelineTasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `emailCampaignEvents` MODIFY COLUMN `kind` enum('gesendet','geoeffnet','geklickt','gewartet','verzweigt','beendet','fehler','abgemeldet','bounce','beschwerde') NOT NULL;--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` MODIFY COLUMN `status` enum('wartet','laeuft','fertig','fehler','abgemeldet','bounce','beschwerde') NOT NULL DEFAULT 'wartet';--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `variant` varchar(1);--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `clickedUrls` json;--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `bouncedAt` timestamp;--> statement-breakpoint
ALTER TABLE `emailCampaigns` ADD `sendWindow` json;--> statement-breakpoint
ALTER TABLE `emailCampaigns` ADD `isTemplate` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `emailCampaigns` ADD `abSplit` int DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `followUpAt` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `appointmentAt` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `dealValue` decimal(12,2);--> statement-breakpoint
CREATE INDEX `outbound_messages_lead_idx` ON `outboundMessages` (`tenantId`,`leadId`);--> statement-breakpoint
CREATE INDEX `pipeline_tasks_due_idx` ON `pipelineTasks` (`tenantId`,`doneAt`,`dueAt`);--> statement-breakpoint
CREATE INDEX `pipeline_tasks_lead_idx` ON `pipelineTasks` (`tenantId`,`leadId`);