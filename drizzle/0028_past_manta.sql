ALTER TABLE `invitations` ADD `partnerType` enum('intern','käufer','lieferant') DEFAULT 'intern' NOT NULL;--> statement-breakpoint
ALTER TABLE `invitations` ADD `integrationId` int;--> statement-breakpoint
ALTER TABLE `memberships` ADD `partnerType` enum('intern','käufer','lieferant') DEFAULT 'intern' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `integrationId` int;--> statement-breakpoint
CREATE INDEX `membership_partner_type_idx` ON `memberships` (`tenantId`,`partnerType`);