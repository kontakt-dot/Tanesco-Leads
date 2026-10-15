UPDATE `telephonySettings` SET `provider` = 'simulation' WHERE `provider` = 'twilio';--> statement-breakpoint
ALTER TABLE `telephonySettings` MODIFY COLUMN `provider` enum('simulation','sipgate') NOT NULL DEFAULT 'simulation';
