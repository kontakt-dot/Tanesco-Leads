CREATE TABLE `d2dAgencies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`contactName` varchar(160),
	`email` varchar(320),
	`phone` varchar(48),
	`notes` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `d2dAgencies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `d2dCaptures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`repId` int NOT NULL,
	`agencyId` int,
	`leadId` int,
	`categoryId` int NOT NULL,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	`firstName` varchar(120),
	`lastName` varchar(120),
	`phone` varchar(48),
	`email` varchar(320),
	`street` varchar(200),
	`postcode` varchar(24),
	`city` varchar(120),
	`country` varchar(2) NOT NULL DEFAULT 'DE',
	`notes` text,
	`consentGiven` boolean NOT NULL DEFAULT false,
	`consentText` text,
	`status` enum('vorerfasst','uebermittelt','fehler') NOT NULL DEFAULT 'vorerfasst',
	`partnerReference` varchar(160),
	`deliveryNote` varchar(320),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `d2dCaptures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `d2dDailyStats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`accountId` int,
	`subId` varchar(64) NOT NULL,
	`day` varchar(10) NOT NULL,
	`total` int NOT NULL DEFAULT 0,
	`qualified` int NOT NULL DEFAULT 0,
	`open` int NOT NULL DEFAULT 0,
	`cancelled` int NOT NULL DEFAULT 0,
	`syncedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `d2dDailyStats_id` PRIMARY KEY(`id`),
	CONSTRAINT `d2d_daily_stats_unique` UNIQUE(`tenantId`,`subId`,`day`)
);
--> statement-breakpoint
CREATE TABLE `d2dReps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`agencyId` int,
	`userId` int,
	`name` varchar(160) NOT NULL,
	`email` varchar(320),
	`phone` varchar(48),
	`subId` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `d2dReps_id` PRIMARY KEY(`id`),
	CONSTRAINT `d2d_reps_subid_unique` UNIQUE(`tenantId`,`subId`)
);
--> statement-breakpoint
CREATE TABLE `d2dSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`aroundhomeAccountId` int,
	`orderId` int,
	`supplierId` int,
	`consentText` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `d2dSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `d2d_settings_tenant_unique` UNIQUE(`tenantId`)
);
--> statement-breakpoint
CREATE INDEX `d2d_agencies_tenant_idx` ON `d2dAgencies` (`tenantId`);--> statement-breakpoint
CREATE INDEX `d2d_captures_tenant_idx` ON `d2dCaptures` (`tenantId`,`capturedAt`);--> statement-breakpoint
CREATE INDEX `d2d_captures_rep_idx` ON `d2dCaptures` (`repId`,`capturedAt`);--> statement-breakpoint
CREATE INDEX `d2d_reps_tenant_idx` ON `d2dReps` (`tenantId`);