CREATE TABLE `leadImportBatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`categoryId` int NOT NULL,
	`fileName` varchar(240) NOT NULL,
	`totalRows` int NOT NULL DEFAULT 0,
	`importedRows` int NOT NULL DEFAULT 0,
	`errorRows` int NOT NULL DEFAULT 0,
	`status` enum('vorschau','abgeschlossen','teilweise','rueckgaengig') NOT NULL DEFAULT 'vorschau',
	`leadPublicIds` json,
	`errorDetails` json,
	`createdByUserId` int NOT NULL,
	`undoneAt` timestamp,
	`undoneByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leadImportBatches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lead_import_batch_tenant_idx` ON `leadImportBatches` (`tenantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `lead_import_batch_status_idx` ON `leadImportBatches` (`tenantId`,`status`);