CREATE TABLE `integrationPresets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` varchar(320),
	`kind` enum('endpoint','response_mapping','return_webhook') NOT NULL,
	`categoryId` int,
	`payloadEncrypted` text NOT NULL,
	`usageCount` int NOT NULL DEFAULT 0,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrationPresets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `integration_presets_tenant_idx` ON `integrationPresets` (`tenantId`,`kind`);