CREATE TABLE `listImports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`listName` varchar(160) NOT NULL,
	`source` enum('kaltakquise','kampagne') NOT NULL DEFAULT 'kaltakquise',
	`rowCount` int NOT NULL DEFAULT 0,
	`created` int NOT NULL DEFAULT 0,
	`updated` int NOT NULL DEFAULT 0,
	`duplicates` int NOT NULL DEFAULT 0,
	`toPipeline` boolean NOT NULL DEFAULT true,
	`leadIds` json,
	`undoneAt` timestamp,
	`actorUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `listImports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `list_imports_tenant_idx` ON `listImports` (`tenantId`,`createdAt`);
