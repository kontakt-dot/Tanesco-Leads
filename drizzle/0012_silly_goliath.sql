CREATE TABLE `categoryFieldMappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`categoryId` int NOT NULL,
	`sourceField` varchar(160) NOT NULL,
	`targetFieldKey` varchar(120) NOT NULL,
	`mode` enum('uebernehmen','umschreiben') NOT NULL DEFAULT 'uebernehmen',
	`searchValue` varchar(255),
	`replaceValue` varchar(255),
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categoryFieldMappings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categoryFields` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`categoryId` int NOT NULL,
	`label` varchar(160) NOT NULL,
	`fieldKey` varchar(120) NOT NULL,
	`fieldType` enum('text','zahl','auswahl','ja_nein','datum','notiz') NOT NULL DEFAULT 'text',
	`options` json,
	`required` boolean NOT NULL DEFAULT false,
	`visible` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categoryFields_id` PRIMARY KEY(`id`),
	CONSTRAINT `category_field_unique` UNIQUE(`categoryId`,`fieldKey`)
);
--> statement-breakpoint
CREATE INDEX `category_mapping_tenant_category_idx` ON `categoryFieldMappings` (`tenantId`,`categoryId`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `category_field_tenant_category_idx` ON `categoryFields` (`tenantId`,`categoryId`,`sortOrder`);