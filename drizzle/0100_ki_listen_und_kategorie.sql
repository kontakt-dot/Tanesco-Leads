ALTER TABLE `emailCampaignRecipients` ADD `fitState` varchar(12);--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `fitNote` varchar(300);--> statement-breakpoint
ALTER TABLE `emailCampaigns` ADD `prewriteOffLists` json;