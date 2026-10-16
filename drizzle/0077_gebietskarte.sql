CREATE TABLE `territories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`customerName` varchar(160) NOT NULL,
	`categoryId` int,
	`color` varchar(9) NOT NULL,
	`postcodes` json NOT NULL,
	`rawCount` int NOT NULL DEFAULT 0,
	`note` varchar(240),
	`sourceName` varchar(160),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `territories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `territories_tenant_idx` ON `territories` (`tenantId`);
