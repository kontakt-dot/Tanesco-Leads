CREATE TABLE `rawBatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`categoryId` int NOT NULL,
	`supplierId` int,
	`sourceName` varchar(160),
	`mapping` json,
	`rowCount` int NOT NULL DEFAULT 0,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rawBatches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rawContacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`batchId` int NOT NULL,
	`firstName` varchar(120),
	`lastName` varchar(120),
	`company` varchar(160),
	`phone` varchar(48),
	`email` varchar(320),
	`postcode` varchar(24),
	`city` varchar(120),
	`country` varchar(2) NOT NULL DEFAULT 'DE',
	`data` json,
	`status` enum('neu','in_liste','konvertiert','verworfen','duplikat') NOT NULL DEFAULT 'neu',
	`leadId` int,
	`duplicateOfLeadId` int,
	`note` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rawContacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `dialerQueueItems` MODIFY COLUMN `leadId` int;--> statement-breakpoint
ALTER TABLE `callRecords` ADD `rawContactId` int;--> statement-breakpoint
ALTER TABLE `dialerCalls` ADD `rawContactId` int;--> statement-breakpoint
ALTER TABLE `dialerQueueItems` ADD `rawContactId` int;--> statement-breakpoint
ALTER TABLE `dialerQueueItems` ADD CONSTRAINT `dialer_queue_raw_unique` UNIQUE(`campaignId`,`rawContactId`);--> statement-breakpoint
CREATE INDEX `raw_batches_tenant_idx` ON `rawBatches` (`tenantId`);--> statement-breakpoint
CREATE INDEX `raw_contacts_batch_idx` ON `rawContacts` (`batchId`,`status`);--> statement-breakpoint
CREATE INDEX `raw_contacts_tenant_idx` ON `rawContacts` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `raw_contacts_phone_idx` ON `rawContacts` (`tenantId`,`phone`);