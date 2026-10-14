ALTER TABLE `integrationEvents` ADD `externalReference` varchar(160);--> statement-breakpoint
ALTER TABLE `integrationEvents` ADD `responseStatus` int;--> statement-breakpoint
ALTER TABLE `integrationEvents` ADD `responseBody` text;