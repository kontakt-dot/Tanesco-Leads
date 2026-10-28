ALTER TABLE `emailCampaignEvents` ADD `delivery` varchar(16);--> statement-breakpoint
ALTER TABLE `emailCampaignEvents` ADD `deliveryNote` varchar(255);--> statement-breakpoint
ALTER TABLE `emailCampaignEvents` ADD `deliveryAt` timestamp;