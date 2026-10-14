CREATE TABLE `organizationProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`partnerType` enum('käufer','lieferant') NOT NULL,
	`name` varchar(160) NOT NULL,
	`email` varchar(320),
	`phone` varchar(48),
	`integrationId` int,
	`status` enum('aktiv','inaktiv') NOT NULL DEFAULT 'aktiv',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizationProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_profile_tenant_type_name_unique` UNIQUE(`tenantId`,`partnerType`,`name`)
);
--> statement-breakpoint
CREATE INDEX `organization_profile_tenant_idx` ON `organizationProfiles` (`tenantId`,`partnerType`);