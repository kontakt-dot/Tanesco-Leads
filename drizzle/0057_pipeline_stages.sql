CREATE TABLE `pipelineStageConfigs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`stages` json NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pipelineStageConfigs_id` PRIMARY KEY(`id`),
	CONSTRAINT `pipeline_stage_configs_tenant_unique` UNIQUE(`tenantId`)
);
