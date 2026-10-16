ALTER TABLE `listImports` ADD `kind` enum('upload','loeschung') NOT NULL DEFAULT 'upload';
--> statement-breakpoint
ALTER TABLE `listImports` ADD `note` varchar(240);
--> statement-breakpoint
ALTER TABLE `emailCampaigns` ADD `maxRuns` int NOT NULL DEFAULT 1;
