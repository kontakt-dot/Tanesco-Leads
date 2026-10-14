ALTER TABLE `emailEvents` MODIFY COLUMN `deliveryStatus` enum('entwurf','geplant','gesendet','simuliert','zugestellt','fehlgeschlagen','geöffnet','übersprungen','abgebrochen') NOT NULL DEFAULT 'entwurf';--> statement-breakpoint
ALTER TABLE `emailEvents` ADD `kind` varchar(40);--> statement-breakpoint
ALTER TABLE `emailEvents` ADD `membershipId` int;--> statement-breakpoint
ALTER TABLE `emailEvents` ADD `scheduledFor` timestamp;--> statement-breakpoint
ALTER TABLE `emailEvents` ADD `bodyPreview` text;--> statement-breakpoint
ALTER TABLE `emailEvents` ADD `note` varchar(240);--> statement-breakpoint
ALTER TABLE `emailTemplates` ADD `kind` enum('frei','willkommen','erinnerung_1','erinnerung_2','erinnerung_3') DEFAULT 'frei' NOT NULL;--> statement-breakpoint
ALTER TABLE `emailTemplates` ADD `delayDays` int DEFAULT 0 NOT NULL;