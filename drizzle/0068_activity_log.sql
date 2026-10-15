CREATE TABLE `activityLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`kind` varchar(40) NOT NULL,
	`title` varchar(200) NOT NULL,
	`detail` varchar(400),
	`count` int NOT NULL DEFAULT 1,
	`leadId` int,
	`actorUserId` int,
	`refType` varchar(40),
	`refId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activityLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `activity_log_tenant_idx` ON `activityLog` (`tenantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `activity_log_ref_idx` ON `activityLog` (`tenantId`,`refType`,`refId`);
