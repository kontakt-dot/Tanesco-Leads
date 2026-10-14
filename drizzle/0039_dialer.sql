CREATE TABLE `agentSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`userId` int NOT NULL,
	`campaignId` int,
	`mode` enum('manuell','power','predictive') NOT NULL DEFAULT 'manuell',
	`status` enum('bereit','waehlt','im_gespraech','nachbereitung','pause','offline') NOT NULL DEFAULT 'bereit',
	`connection` enum('browser','telefon') NOT NULL DEFAULT 'browser',
	`agentPhone` varchar(32),
	`currentCallId` int,
	`lastActivityAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	CONSTRAINT `agentSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_sessions_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `dialerCalls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`campaignId` int,
	`queueItemId` int,
	`leadId` int,
	`agentUserId` int,
	`mode` enum('manuell','power','predictive') NOT NULL DEFAULT 'manuell',
	`provider` varchar(40) NOT NULL,
	`providerCallSid` varchar(64),
	`fromNumber` varchar(32),
	`toNumber` varchar(32) NOT NULL,
	`status` enum('initiiert','klingelt','wartet','verbunden','beendet','besetzt','keine_antwort','anrufbeantworter','abgebrochen','fehlgeschlagen') NOT NULL DEFAULT 'initiiert',
	`amdResult` varchar(40),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`answeredAt` timestamp,
	`connectedAt` timestamp,
	`endedAt` timestamp,
	`durationSeconds` int,
	`talkSeconds` int,
	`recordingSid` varchar(64),
	`recordingUrl` text,
	`consentAt` timestamp,
	`disposition` varchar(60),
	`notes` text,
	`callRecordId` int,
	`costCents` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dialerCalls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dialerCampaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`mode` enum('manuell','power','predictive') NOT NULL DEFAULT 'power',
	`status` enum('entwurf','aktiv','pausiert','beendet') NOT NULL DEFAULT 'entwurf',
	`leadFilter` json,
	`callerNumberId` int,
	`maxAttempts` int,
	`retryMinutes` int,
	`wrapUpSeconds` int,
	`pacingRatio` decimal(4,2),
	`callWindow` json,
	`script` text,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dialerCampaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dialerQueueItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`campaignId` int NOT NULL,
	`leadId` int NOT NULL,
	`phone` varchar(32) NOT NULL,
	`status` enum('offen','waehlt','verbunden','wiederholen','erledigt','ausgeschlossen') NOT NULL DEFAULT 'offen',
	`attempts` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp,
	`lastResult` varchar(80),
	`lastCallId` int,
	`lockedByUserId` int,
	`priority` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dialerQueueItems_id` PRIMARY KEY(`id`),
	CONSTRAINT `dialer_queue_unique` UNIQUE(`campaignId`,`leadId`)
);
--> statement-breakpoint
CREATE TABLE `phoneNumbers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`provider` varchar(40) NOT NULL,
	`providerSid` varchar(64),
	`e164` varchar(32) NOT NULL,
	`country` varchar(2) NOT NULL,
	`numberType` enum('lokal','mobil','national','kostenfrei') NOT NULL DEFAULT 'lokal',
	`friendlyName` varchar(120),
	`region` varchar(120),
	`monthlyPrice` decimal(8,2),
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`status` enum('aktiv','gekuendigt') NOT NULL DEFAULT 'aktiv',
	`purchasedAt` timestamp NOT NULL DEFAULT (now()),
	`releasedAt` timestamp,
	CONSTRAINT `phoneNumbers_id` PRIMARY KEY(`id`),
	CONSTRAINT `phone_numbers_e164_unique` UNIQUE(`tenantId`,`e164`)
);
--> statement-breakpoint
CREATE TABLE `telephonySettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`provider` enum('simulation','twilio') NOT NULL DEFAULT 'simulation',
	`accountSid` varchar(64),
	`credentialsEncrypted` text,
	`twimlAppSid` varchar(64),
	`addressSid` varchar(64),
	`bundleSids` json,
	`defaultNumberId` int,
	`agentConnection` enum('browser','telefon') NOT NULL DEFAULT 'browser',
	`announcement` text,
	`consentMode` enum('ansage','agent_button','keine') NOT NULL DEFAULT 'agent_button',
	`recordCalls` boolean NOT NULL DEFAULT true,
	`amdEnabled` boolean NOT NULL DEFAULT true,
	`maxAttempts` int NOT NULL DEFAULT 3,
	`retryMinutes` int NOT NULL DEFAULT 240,
	`wrapUpSeconds` int NOT NULL DEFAULT 20,
	`pacingRatio` decimal(4,2) NOT NULL DEFAULT '1.50',
	`maxAbandonRate` decimal(5,2) NOT NULL DEFAULT '3.00',
	`callWindow` json,
	`webhookSecret` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telephonySettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `telephony_settings_tenant_unique` UNIQUE(`tenantId`)
);
--> statement-breakpoint
ALTER TABLE `callQaConfigs` ADD `decisionRules` json;--> statement-breakpoint
ALTER TABLE `callQaConfigs` ADD `examples` json;--> statement-breakpoint
ALTER TABLE `callQaConfigs` ADD `extractFields` json;--> statement-breakpoint
CREATE INDEX `agent_sessions_tenant_idx` ON `agentSessions` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `dialer_calls_tenant_idx` ON `dialerCalls` (`tenantId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `dialer_calls_campaign_idx` ON `dialerCalls` (`campaignId`,`status`);--> statement-breakpoint
CREATE INDEX `dialer_calls_sid_idx` ON `dialerCalls` (`providerCallSid`);--> statement-breakpoint
CREATE INDEX `dialer_campaigns_tenant_idx` ON `dialerCampaigns` (`tenantId`);--> statement-breakpoint
CREATE INDEX `dialer_queue_campaign_idx` ON `dialerQueueItems` (`campaignId`,`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `phone_numbers_tenant_idx` ON `phoneNumbers` (`tenantId`);