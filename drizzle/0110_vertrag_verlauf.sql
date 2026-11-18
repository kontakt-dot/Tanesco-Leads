ALTER TABLE `contractEvents` MODIFY COLUMN `kind` enum('erstellt','gesendet','erinnert','angesehen','unterschrieben','abgelehnt','storniert','geaendert','mail_geoeffnet','pdf_geladen') NOT NULL;--> statement-breakpoint
ALTER TABLE `contractEvents` ADD `source` varchar(16);--> statement-breakpoint
ALTER TABLE `contractEvents` ADD `seconds` int;--> statement-breakpoint
ALTER TABLE `contractEvents` ADD `depth` int;