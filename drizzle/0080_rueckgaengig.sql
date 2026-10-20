CREATE TABLE `undoLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`actorUserId` int,
	`kind` varchar(40) NOT NULL,
	`title` varchar(300) NOT NULL,
	`count` int NOT NULL DEFAULT 1,
	`payload` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`undoneAt` timestamp,
	`undoneByUserId` int,
	CONSTRAINT `undoLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `undo_log_tenant_idx` ON `undoLog` (`tenantId`,`createdAt`);