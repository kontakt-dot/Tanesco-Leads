ALTER TABLE `telephonySettings` MODIFY COLUMN `provider` enum('simulation','twilio','sipgate') NOT NULL DEFAULT 'simulation';--> statement-breakpoint
ALTER TABLE `telephonySettings` MODIFY COLUMN `agentConnection` enum('browser','telefon','sipgate') NOT NULL DEFAULT 'browser';--> statement-breakpoint
ALTER TABLE `telephonySettings` ADD `sipgateEncrypted` text;--> statement-breakpoint
ALTER TABLE `telephonySettings` ADD `sipgateUserId` varchar(16);--> statement-breakpoint
ALTER TABLE `telephonySettings` ADD `sipgateSystem` varchar(10);--> statement-breakpoint
ALTER TABLE `telephonySettings` ADD `sipgateSmsId` varchar(16);--> statement-breakpoint
ALTER TABLE `telephonySettings` ADD `sipgateDeviceId` varchar(16);--> statement-breakpoint
ALTER TABLE `telephonySettings` ADD `sipgateWebhookAt` timestamp;--> statement-breakpoint
ALTER TABLE `agentSessions` MODIFY COLUMN `connection` enum('browser','telefon','sipgate') NOT NULL DEFAULT 'browser';--> statement-breakpoint
ALTER TABLE `agentSessions` ADD `agentDeviceId` varchar(16);--> statement-breakpoint
ALTER TABLE `dialerCalls` ADD `providerRecordingUrl` text;--> statement-breakpoint
ALTER TABLE `dialerCalls` ADD `providerSessionId` varchar(64);
