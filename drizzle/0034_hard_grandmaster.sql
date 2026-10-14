ALTER TABLE `organizationProfiles` ADD `archivedAt` timestamp;--> statement-breakpoint
ALTER TABLE `organizationProfiles` ADD `archivedByUserId` int;--> statement-breakpoint
CREATE INDEX `organization_profile_tenant_archive_idx` ON `organizationProfiles` (`tenantId`,`archivedAt`);