CREATE TABLE `leadDeletionEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`publicId` varchar(12) NOT NULL,
	`deletedLeadId` int NOT NULL,
	`deletedByUserId` int NOT NULL,
	`reason` varchar(240),
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leadDeletionEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lead_deletion_event_tenant_idx` ON `leadDeletionEvents` (`tenantId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lead_deletion_event_public_id_idx` ON `leadDeletionEvents` (`tenantId`,`publicId`);