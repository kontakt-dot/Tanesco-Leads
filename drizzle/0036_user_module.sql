CREATE TABLE `balanceTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`kind` enum('aufladung','abbuchung','auszahlung') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`description` varchar(320),
	`actorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `balanceTransactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supplierInboundMappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`kind` enum('kategorie','feld','wert') NOT NULL,
	`categoryId` int,
	`fieldKey` varchar(120),
	`sourceValue` varchar(255) NOT NULL,
	`targetValue` varchar(255) NOT NULL,
	`strict` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplierInboundMappings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` MODIFY COLUMN `paymentMode` enum('standard','vorkasse','auf_rechnung','gesperrt','karte_pro_lead','sepa_pro_lead') NOT NULL DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE `apiTokens` ADD `tokenEncrypted` text;--> statement-breakpoint
ALTER TABLE `apiTokens` ADD `membershipId` int;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `reclamationPeriodHours` int DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `autoAcceptApiClaims` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `blockedClaimCategoryIds` json;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `excludedClaimReasonIds` json;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `billingInterval` enum('7_tage','14_tage','30_tage','woechentlich_freitag') DEFAULT '30_tage' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `paymentTermsDays` int DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `taxRatePercent` decimal(5,2);--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `notifyLeads` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `notifyLeadsEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `notifyInvoices` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `notifyInvoicesEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `notifySystem` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `notifySystemEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `duplicateProtection` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `inboundPrePing` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `visibleAreas` json;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `visibleCategoryIds` json;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `webhookUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `supplierActive` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `commissionOnEverySale` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `supplierBalance` decimal(12,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `commissionRates` json;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `userId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `salutation` varchar(16);--> statement-breakpoint
ALTER TABLE `users` ADD `firstName` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `lastName` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `company` varchar(160);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `billingStreet` varchar(200);--> statement-breakpoint
ALTER TABLE `users` ADD `billingPostalCode` varchar(16);--> statement-breakpoint
ALTER TABLE `users` ADD `billingCity` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `billingCountry` varchar(2);--> statement-breakpoint
CREATE INDEX `balance_transactions_member_idx` ON `balanceTransactions` (`tenantId`,`membershipId`);--> statement-breakpoint
CREATE INDEX `supplier_inbound_mappings_member_idx` ON `supplierInboundMappings` (`tenantId`,`membershipId`);