CREATE TABLE `leadStatusEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`previousStatus` varchar(32),
	`nextStatus` varchar(32) NOT NULL,
	`note` text,
	`actorUserId` int,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leadStatusEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lead_status_event_tenant_idx` ON `leadStatusEvents` (`tenantId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lead_status_event_lead_idx` ON `leadStatusEvents` (`leadId`,`occurredAt`);