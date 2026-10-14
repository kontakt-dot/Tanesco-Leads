CREATE TABLE `deliveryEndpoints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`categoryId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`method` enum('POST','PUT','PATCH') NOT NULL DEFAULT 'POST',
	`url` text NOT NULL,
	`sourceFilterMode` enum('alle','nur','ausser') NOT NULL DEFAULT 'alle',
	`sourceSupplierIds` json,
	`fieldFilters` json,
	`headersEncrypted` text,
	`authEnabled` boolean NOT NULL DEFAULT false,
	`authConfigEncrypted` text,
	`bodyTemplate` text,
	`omitAutoFields` boolean NOT NULL DEFAULT false,
	`rotate` boolean NOT NULL DEFAULT false,
	`valueMappings` json,
	`sentCount` int NOT NULL DEFAULT 0,
	`position` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deliveryEndpoints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partnerAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`provider` enum('aroundhome','wattfox','hlrlookup') NOT NULL,
	`label` varchar(120),
	`publisherId` varchar(120),
	`credentialsEncrypted` text,
	`reclaimOnCancel` boolean NOT NULL DEFAULT false,
	`reclaimReasonId` int,
	`trackingToken` varchar(96),
	`enabled` boolean NOT NULL DEFAULT true,
	`lastSyncAt` timestamp,
	`lastSyncSummary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partnerAccounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partnerCallbacks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`provider` enum('aroundhome','wattfox') NOT NULL,
	`accountId` int,
	`leadId` int,
	`status` varchar(80),
	`reasonText` varchar(255),
	`payload` json,
	`claimId` int,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partnerCallbacks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partnerCancelRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`provider` enum('aroundhome','wattfox') NOT NULL,
	`matchOp` enum('enthaelt','gleich','beginnt') NOT NULL DEFAULT 'gleich',
	`matchValue` varchar(255) NOT NULL,
	`reasonId` int NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partnerCancelRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partnerResponseRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`source` enum('body','status') NOT NULL DEFAULT 'body',
	`field` varchar(120),
	`op` enum('gleich','beginnt','enthaelt') NOT NULL DEFAULT 'gleich',
	`value` varchar(255) NOT NULL,
	`label` varchar(160),
	`reasonId` int NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`position` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partnerResponseRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supplierReturnWebhooks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`categoryId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`method` enum('POST','PUT','PATCH') NOT NULL DEFAULT 'POST',
	`url` text,
	`headersEncrypted` text,
	`bodyTemplate` text,
	`omitAutoFields` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supplierReturnWebhooks_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_return_webhooks_unique` UNIQUE(`membershipId`,`categoryId`)
);
--> statement-breakpoint
ALTER TABLE `integrationEvents` MODIFY COLUMN `integrationId` int;--> statement-breakpoint
ALTER TABLE `integrationEvents` ADD `endpointId` int;--> statement-breakpoint
ALTER TABLE `memberOperationalSettings` ADD `responseMappingEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reclamationReasons` ADD `forwardToNextStop` boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `delivery_endpoints_member_idx` ON `deliveryEndpoints` (`tenantId`,`membershipId`,`categoryId`);--> statement-breakpoint
CREATE INDEX `partner_accounts_tenant_idx` ON `partnerAccounts` (`tenantId`,`provider`);--> statement-breakpoint
CREATE INDEX `partner_callbacks_tenant_idx` ON `partnerCallbacks` (`tenantId`,`provider`);--> statement-breakpoint
CREATE INDEX `partner_cancel_rules_tenant_idx` ON `partnerCancelRules` (`tenantId`,`provider`);--> statement-breakpoint
CREATE INDEX `partner_response_rules_member_idx` ON `partnerResponseRules` (`tenantId`,`membershipId`);