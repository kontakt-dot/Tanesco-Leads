ALTER TABLE `tenantSettings` ADD `companyFooter` varchar(300);--> statement-breakpoint
ALTER TABLE `tenantSettings` ADD `websiteUrl` varchar(300);--> statement-breakpoint
ALTER TABLE `tenantSettings` ADD `appointmentUrl` varchar(300);--> statement-breakpoint
ALTER TABLE `tenantSettings` ADD `uploadDuplicateMode` enum('aktualisieren','ueberspringen') DEFAULT 'aktualisieren' NOT NULL;
