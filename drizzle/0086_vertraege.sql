CREATE TABLE `contractEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`contractId` int NOT NULL,
	`kind` enum('erstellt','gesendet','erinnert','angesehen','unterschrieben','abgelehnt','storniert','geaendert') NOT NULL,
	`note` varchar(400),
	`ip` varchar(64),
	`userAgent` varchar(400),
	`actorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contractEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contractTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`title` varchar(200),
	`blocks` json NOT NULL,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contractTemplates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`number` varchar(24) NOT NULL,
	`title` varchar(200) NOT NULL,
	`status` enum('entwurf','gesendet','angesehen','unterschrieben','abgelehnt','storniert') NOT NULL DEFAULT 'entwurf',
	`leadId` int,
	`templateId` int,
	`blocks` json NOT NULL,
	`values` json NOT NULL,
	`token` varchar(64),
	`recipientEmail` varchar(320),
	`recipientName` varchar(200),
	`message` text,
	`ourSignerName` varchar(160),
	`ourSignedAt` timestamp,
	`sentAt` timestamp,
	`viewedAt` timestamp,
	`signedAt` timestamp,
	`declinedAt` timestamp,
	`declineReason` varchar(400),
	`signerName` varchar(200),
	`signerEmail` varchar(320),
	`signerIp` varchar(64),
	`signerUserAgent` varchar(400),
	`signatureImage` mediumtext,
	`documentHash` varchar(64),
	`signatureHash` varchar(64),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contracts_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `contract_events_contract_idx` ON `contractEvents` (`tenantId`,`contractId`);--> statement-breakpoint
CREATE INDEX `contract_templates_tenant_idx` ON `contractTemplates` (`tenantId`);--> statement-breakpoint
CREATE INDEX `contracts_tenant_idx` ON `contracts` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `contracts_lead_idx` ON `contracts` (`leadId`);