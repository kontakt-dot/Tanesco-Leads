ALTER TABLE `leads` ADD `assignedUserId` int;--> statement-breakpoint
CREATE INDEX `lead_tenant_assignee_idx` ON `leads` (`tenantId`,`assignedUserId`);