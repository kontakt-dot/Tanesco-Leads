CREATE TABLE `emailEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`templateId` int,
	`recipientEmail` varchar(320) NOT NULL,
	`subject` varchar(240) NOT NULL,
	`deliveryStatus` enum('entwurf','gesendet','zugestellt','fehlgeschlagen','geöffnet') NOT NULL DEFAULT 'entwurf',
	`providerMessageId` varchar(160),
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emailEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emailTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`subject` varchar(240) NOT NULL,
	`bodyHtml` text NOT NULL,
	`status` enum('entwurf','aktiv','archiviert') NOT NULL DEFAULT 'entwurf',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emailTemplates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `email_event_tenant_idx` ON `emailEvents` (`tenantId`);--> statement-breakpoint
CREATE INDEX `email_template_tenant_idx` ON `emailTemplates` (`tenantId`);