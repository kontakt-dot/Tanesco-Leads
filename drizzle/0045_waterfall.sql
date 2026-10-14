CREATE TABLE `deliveryStopReasons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stopId` int NOT NULL,
	`reasonId` int NOT NULL,
	`allowed` boolean NOT NULL DEFAULT true,
	`passOn` boolean NOT NULL DEFAULT false,
	CONSTRAINT `deliveryStopReasons_id` PRIMARY KEY(`id`),
	CONSTRAINT `delivery_stop_reason_unique` UNIQUE(`stopId`,`reasonId`)
);
--> statement-breakpoint
ALTER TABLE `leadDeliveries` MODIFY COLUMN `result` enum('angeboten','angenommen','abgelehnt','übersprungen','reklamiert') NOT NULL DEFAULT 'angeboten';--> statement-breakpoint
ALTER TABLE `deliveryChains` ADD `dailyCap` int;--> statement-breakpoint
ALTER TABLE `deliveryChains` ADD `totalCap` int;--> statement-breakpoint
ALTER TABLE `deliveryChains` ADD `exhaustedAction` enum('return','release') DEFAULT 'release' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveryChains` ADD `exhaustedOverrides` json;--> statement-breakpoint
ALTER TABLE `deliveryChains` ADD `country` varchar(2);--> statement-breakpoint
ALTER TABLE `deliveryChains` ADD `supplierFilterMode` enum('all','include','exclude') DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveryChains` ADD `supplierIds` json;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `buyerUserId` int;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `reclamationWindowHours` int DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `maxLeads` int;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `geoCountry` varchar(2);--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `geoMode` enum('landesweit','bundesland','plz') DEFAULT 'landesweit' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `geoValues` json;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `fieldFilters` json;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `excludedSupplierIds` json;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `excludedBuyerUserIds` json;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `excludeAutomationDuplicates` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `phoneFilter` enum('all','exclude_invalid','only_valid') DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `deliveryStops` ADD `maxLeadAgeMinutes` int;--> statement-breakpoint
ALTER TABLE `leadDeliveries` ADD `windowEndsAt` timestamp;--> statement-breakpoint
ALTER TABLE `leadDeliveries` ADD `acceptedAt` timestamp;--> statement-breakpoint
ALTER TABLE `leadDeliveries` ADD `skipReason` varchar(160);--> statement-breakpoint
ALTER TABLE `leadDeliveries` ADD `claimId` int;--> statement-breakpoint
ALTER TABLE `tenantSettings` ADD `chainDistributionMode` enum('lieferketten_round_robin','bestellungen_round_robin') DEFAULT 'lieferketten_round_robin' NOT NULL;