CREATE TABLE `cooperationCategoryMappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cooperationId` int NOT NULL,
	`sourceCategoryId` int NOT NULL,
	`partnerCategoryName` varchar(160) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cooperationCategoryMappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `cooperation_category_unique` UNIQUE(`cooperationId`,`sourceCategoryId`)
);
--> statement-breakpoint
CREATE TABLE `cooperationFieldMappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cooperationId` int NOT NULL,
	`sourceField` varchar(120) NOT NULL,
	`partnerField` varchar(120),
	`transfer` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cooperationFieldMappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `cooperation_field_unique` UNIQUE(`cooperationId`,`sourceField`)
);
--> statement-breakpoint
CREATE TABLE `cooperations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`partnerTenantName` varchar(160) NOT NULL,
	`partnerTenantId` int,
	`direction` enum('eingehend','ausgehend','beidseitig') NOT NULL DEFAULT 'ausgehend',
	`status` enum('angefragt','aktiv','inaktiv') NOT NULL DEFAULT 'angefragt',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cooperations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `cooperation_tenant_idx` ON `cooperations` (`tenantId`);