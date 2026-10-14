CREATE TABLE `orderEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`orderId` int NOT NULL,
	`eventType` enum('erstellt','konfiguration_gespeichert','aktiviert','pausiert','synchronisiert','notiz') NOT NULL,
	`note` text,
	`actorUserId` int,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orderEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orderOperationalConfigs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`orderId` int NOT NULL,
	`orderNote` text,
	`buyerUserId` int,
	`categoryIds` json,
	`ignoreSupplierCommission` boolean NOT NULL DEFAULT false,
	`deliveryInterval` enum('sofort','täglich','wöchentlich','monatlich') NOT NULL DEFAULT 'täglich',
	`requestedQuantity` int NOT NULL DEFAULT 1,
	`compensateClaims` boolean NOT NULL DEFAULT false,
	`priority` int NOT NULL DEFAULT 1,
	`realtimeDelivery` boolean NOT NULL DEFAULT true,
	`startsAt` timestamp,
	`endsAt` timestamp,
	`ongoing` boolean NOT NULL DEFAULT true,
	`deliveryDays` json,
	`deliveryArea` enum('landesweit','regional','postleitzahlen') NOT NULL DEFAULT 'landesweit',
	`pauses` json,
	`advancedFilters` json,
	`supplierRestrictions` json,
	`syncKey` varchar(96) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orderOperationalConfigs_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_operational_config_order_unique` UNIQUE(`orderId`),
	CONSTRAINT `order_operational_config_sync_key_unique` UNIQUE(`syncKey`)
);
--> statement-breakpoint
CREATE INDEX `order_event_tenant_idx` ON `orderEvents` (`tenantId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `order_event_order_idx` ON `orderEvents` (`orderId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `order_operational_config_tenant_idx` ON `orderOperationalConfigs` (`tenantId`,`orderId`);