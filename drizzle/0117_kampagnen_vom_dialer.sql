ALTER TABLE `callRecords` ADD `dialerCampaign` varchar(160) NULL;--> statement-breakpoint
ALTER TABLE `callQaCampaigns` ADD `dialerNames` json NULL;--> statement-breakpoint
ALTER TABLE `callQaCampaigns` ADD `buyerUserId` int NULL;--> statement-breakpoint
UPDATE `callRecords` SET `dialerCampaign` = LEFT(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.campaign'))), 160) WHERE `payload` IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`payload`, '$.campaign')) IN ('STRING', 'INTEGER') AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.campaign'))) <> '';--> statement-breakpoint
UPDATE `deliveryEndpoints` SET `bodyTemplate` = REPLACE(`bodyTemplate`, '"utm_campaign": "Hyper Energy Solutions, Meta Leadformular"', '"utm_campaign": ""') WHERE `bodyTemplate` LIKE '%"vorlage"%' AND `bodyTemplate` LIKE '%Hyper Energy Solutions, Meta Leadformular%';
