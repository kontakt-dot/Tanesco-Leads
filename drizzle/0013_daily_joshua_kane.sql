CREATE TABLE `teamProductAssignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`teamId` int NOT NULL,
	`productId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `teamProductAssignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_product_assignment_unique` UNIQUE(`teamId`,`productId`)
);
--> statement-breakpoint
CREATE INDEX `team_product_assignment_tenant_idx` ON `teamProductAssignments` (`tenantId`,`teamId`);