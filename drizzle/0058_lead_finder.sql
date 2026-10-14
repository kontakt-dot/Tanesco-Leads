CREATE TABLE `companyProspects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`query` varchar(160),
	`location` varchar(160),
	`name` varchar(200) NOT NULL,
	`website` varchar(400),
	`email` varchar(320),
	`phone` varchar(48),
	`street` varchar(200),
	`postcode` varchar(24),
	`city` varchar(120),
	`lat` decimal(9,6),
	`lng` decimal(9,6),
	`source` varchar(32) NOT NULL,
	`externalId` varchar(160),
	`rating` decimal(3,1),
	`ratingCount` int,
	`profile` json,
	`enrichedAt` timestamp,
	`status` enum('neu','uebernommen','ignoriert') NOT NULL DEFAULT 'neu',
	`leadId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `companyProspects_id` PRIMARY KEY(`id`),
	CONSTRAINT `prospects_external_unique` UNIQUE(`tenantId`,`source`,`externalId`)
);
--> statement-breakpoint
CREATE INDEX `prospects_tenant_idx` ON `companyProspects` (`tenantId`,`createdAt`);