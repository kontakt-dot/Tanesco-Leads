ALTER TABLE `mailSettings` MODIFY COLUMN `campaignDailyLimit` int NOT NULL DEFAULT 80;--> statement-breakpoint
UPDATE `mailSettings` SET `campaignDailyLimit` = 80 WHERE `campaignDailyLimit` = 50 AND lower(`fromEmail`) = 'kontakt@tanescodigital.de';
