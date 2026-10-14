CREATE TABLE `automationExecutionLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`ruleId` int NOT NULL,
	`sourceLeadId` int NOT NULL,
	`result` enum('ausgeführt','übersprungen') NOT NULL,
	`summary` varchar(320) NOT NULL,
	`createdLeadId` int,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `automationExecutionLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `automation_log_tenant_idx` ON `automationExecutionLogs` (`tenantId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `automation_log_rule_idx` ON `automationExecutionLogs` (`ruleId`,`occurredAt`);