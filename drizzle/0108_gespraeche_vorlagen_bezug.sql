ALTER TABLE `callQaCampaigns` ADD `presetKey` varchar(48);--> statement-breakpoint
ALTER TABLE `callQaConfigs` ADD `presetKey` varchar(48);--> statement-breakpoint
ALTER TABLE `callQaConfigs` ADD `setupMarks` json;