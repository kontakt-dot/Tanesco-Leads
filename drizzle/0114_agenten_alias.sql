ALTER TABLE `callQaConfigs` ADD `agentAliases` json;--> statement-breakpoint
ALTER TABLE `callRecords` ADD `agentAlias` varchar(160);