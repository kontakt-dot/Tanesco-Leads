CREATE TABLE `apiTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`scopes` json,
	`lastUsedAt` timestamp,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apiTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_token_hash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `partnerIntegrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`provider` enum('aroundhome','wattfox','webhook') NOT NULL,
	`name` varchar(160) NOT NULL,
	`publisherId` varchar(160),
	`credentialsEncrypted` text,
	`callbackUrl` text,
	`config` json,
	`status` enum('aktiv','inaktiv') NOT NULL DEFAULT 'inaktiv',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partnerIntegrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reclamationReasons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`systemReason` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`forwardToSupplier` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reclamationReasons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenantSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadDeactivationHours` int NOT NULL DEFAULT 0,
	`distributionOrder` enum('fifo','lifo') NOT NULL DEFAULT 'fifo',
	`multisaleBudgetCascade` boolean NOT NULL DEFAULT false,
	`skipEmptyApiFields` boolean NOT NULL DEFAULT false,
	`outgoingDuplicateProtection` boolean NOT NULL DEFAULT true,
	`incomingPrePing` boolean NOT NULL DEFAULT false,
	`duplicateFields` json,
	`duplicateWindowHours` int NOT NULL DEFAULT 0,
	`shopEnabled` boolean NOT NULL DEFAULT false,
	`creditEnabled` boolean NOT NULL DEFAULT false,
	`orderApproval` enum('automatisch','manuell') NOT NULL DEFAULT 'manuell',
	`senderName` varchar(160),
	`supportEmail` varchar(320),
	`emailFooterHtml` text,
	`invoicePrefix` varchar(24) NOT NULL DEFAULT 'RE',
	`vatRate` decimal(5,2) NOT NULL DEFAULT '19.00',
	`acceptedTermsVersion` varchar(32),
	`acceptedTermsAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenantSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenantSettings_tenantId_unique` UNIQUE(`tenantId`)
);
--> statement-breakpoint
CREATE INDEX `api_token_tenant_idx` ON `apiTokens` (`tenantId`);--> statement-breakpoint
CREATE INDEX `partner_integration_tenant_idx` ON `partnerIntegrations` (`tenantId`);--> statement-breakpoint
CREATE INDEX `reclamation_reason_tenant_idx` ON `reclamationReasons` (`tenantId`);--> statement-breakpoint
CREATE INDEX `tenant_settings_tenant_idx` ON `tenantSettings` (`tenantId`);