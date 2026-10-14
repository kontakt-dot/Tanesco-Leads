CREATE TABLE `impersonationSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`adminUserId` int NOT NULL,
	`targetUserId` int NOT NULL,
	`targetMembershipId` int,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	CONSTRAINT `impersonationSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `impersonation_tenant_target_idx` ON `impersonationSessions` (`tenantId`,`targetUserId`);--> statement-breakpoint
CREATE INDEX `impersonation_admin_idx` ON `impersonationSessions` (`adminUserId`);