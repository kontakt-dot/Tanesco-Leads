CREATE TABLE `termsAcceptances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`acceptedByUserId` int NOT NULL,
	`version` varchar(32) NOT NULL,
	`acceptedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `termsAcceptances_id` PRIMARY KEY(`id`),
	CONSTRAINT `terms_acceptance_version_user_unique` UNIQUE(`tenantId`,`acceptedByUserId`,`version`)
);
--> statement-breakpoint
CREATE INDEX `terms_acceptances_tenant_idx` ON `termsAcceptances` (`tenantId`,`acceptedAt`);