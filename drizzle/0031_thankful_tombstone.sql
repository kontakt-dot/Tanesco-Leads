CREATE TABLE `memberOperationalSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`emailNotifications` boolean NOT NULL DEFAULT true,
	`paymentMode` enum('standard','vorkasse','auf_rechnung','gesperrt') NOT NULL DEFAULT 'standard',
	`deliveryPaused` boolean NOT NULL DEFAULT false,
	`claimRefundMode` enum('standard','automatisch','manuell') NOT NULL DEFAULT 'standard',
	`prepaidBalance` decimal(12,2) NOT NULL DEFAULT '0.00',
	`uiRestricted` boolean NOT NULL DEFAULT false,
	`individualLeadCommission` decimal(12,2),
	`disabledCategoryIds` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memberOperationalSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `member_operational_settings_unique` UNIQUE(`membershipId`)
);
--> statement-breakpoint
CREATE INDEX `member_operational_settings_tenant_idx` ON `memberOperationalSettings` (`tenantId`,`membershipId`);