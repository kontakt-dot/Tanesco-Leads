ALTER TABLE `emailCampaignEvents` ADD `messageId` varchar(320);--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `draftSubject` varchar(300);--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `draftText` text;--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `draftState` varchar(16);--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `draftSource` varchar(8);--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `draftAt` timestamp;--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `draftOptions` json;--> statement-breakpoint
ALTER TABLE `emailCampaignRecipients` ADD `draftApproach` varchar(16);--> statement-breakpoint
ALTER TABLE `emailCampaigns` ADD `reviewFirst` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `campaignDailyLimit` int DEFAULT 50 NOT NULL;--> statement-breakpoint
CREATE INDEX `email_events_message_idx` ON `emailCampaignEvents` (`messageId`);