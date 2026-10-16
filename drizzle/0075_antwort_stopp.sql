ALTER TABLE `emailCampaigns` ADD `stopOnReply` boolean NOT NULL DEFAULT true;
--> statement-breakpoint
INSERT INTO `emailCampaignEvents` (`tenantId`, `campaignId`, `recipientId`, `nodeId`, `kind`, `subject`, `note`, `createdAt`)
SELECT r.`tenantId`, r.`campaignId`, r.`id`, r.`nodeId`, 'beendet', NULL, 'Antwort erhalten – Serie gestoppt, keine weitere E-Mail', NOW()
FROM `emailCampaignRecipients` r
JOIN (SELECT `tenantId`, `email`, MAX(`repliedAt`) AS `repliedAt` FROM `emailCampaignRecipients` WHERE `repliedAt` IS NOT NULL GROUP BY `tenantId`, `email`) a ON a.`tenantId` = r.`tenantId` AND a.`email` = r.`email`
WHERE r.`status` IN ('wartet', 'laeuft') AND (r.`repliedAt` IS NOT NULL OR a.`repliedAt` >= r.`createdAt`);
--> statement-breakpoint
UPDATE `emailCampaignRecipients` r
JOIN (SELECT `tenantId`, `email`, MAX(`repliedAt`) AS `repliedAt` FROM `emailCampaignRecipients` WHERE `repliedAt` IS NOT NULL GROUP BY `tenantId`, `email`) a ON a.`tenantId` = r.`tenantId` AND a.`email` = r.`email`
SET r.`status` = 'fertig', r.`nextActionAt` = NULL, r.`nodeId` = NULL, r.`repliedAt` = COALESCE(r.`repliedAt`, a.`repliedAt`)
WHERE r.`status` IN ('wartet', 'laeuft') AND (r.`repliedAt` IS NOT NULL OR a.`repliedAt` >= r.`createdAt`);
