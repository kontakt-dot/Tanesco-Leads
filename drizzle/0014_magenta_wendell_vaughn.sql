CREATE TABLE `productOperationalConfigs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`productId` int NOT NULL,
	`minQuantity` int NOT NULL DEFAULT 1,
	`maxQuantity` int,
	`geoRequired` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `productOperationalConfigs_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_operational_config_unique` UNIQUE(`productId`)
);
--> statement-breakpoint
CREATE INDEX `product_operational_config_tenant_idx` ON `productOperationalConfigs` (`tenantId`,`productId`);