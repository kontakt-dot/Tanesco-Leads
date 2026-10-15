ALTER TABLE `pipelineStageConfigs` ADD `source` varchar(16) DEFAULT 'alle' NOT NULL;--> statement-breakpoint
ALTER TABLE `pipelineStageConfigs` DROP INDEX `pipeline_stage_configs_tenant_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_stage_configs_tenant_source_unique` ON `pipelineStageConfigs` (`tenantId`,`source`);
