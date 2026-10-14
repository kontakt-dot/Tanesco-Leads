CREATE TABLE `integrationEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`integrationId` int NOT NULL,
	`leadId` int,
	`categoryId` int,
	`eventType` enum('geliefert','abgelehnt','angenommen','offen','anerkannt','storniert') NOT NULL,
	`amount` decimal(12,2),
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integrationEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `integration_event_tenant_idx` ON `integrationEvents` (`tenantId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `integration_event_integration_idx` ON `integrationEvents` (`integrationId`,`occurredAt`);