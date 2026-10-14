CREATE TABLE `callQaCampaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`questions` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `callQaCampaigns_id` PRIMARY KEY(`id`),
	CONSTRAINT `call_qa_campaigns_name_unique` UNIQUE(`tenantId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `callRecords` ADD `qualificationAnswers` json;--> statement-breakpoint
CREATE INDEX `call_qa_campaigns_tenant_idx` ON `callQaCampaigns` (`tenantId`);