CREATE TABLE `leadCallAttempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`userId` int,
	`dialerCallId` int,
	`result` enum('erreicht','nicht_erreicht','besetzt','mailbox','rueckruf','falsche_nummer') NOT NULL DEFAULT 'nicht_erreicht',
	`note` varchar(320),
	`at` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leadCallAttempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lead_call_attempts_lead_idx` ON `leadCallAttempts` (`tenantId`,`leadId`);--> statement-breakpoint
CREATE INDEX `lead_call_attempts_dialer_idx` ON `leadCallAttempts` (`dialerCallId`);--> statement-breakpoint
INSERT INTO `leadCallAttempts` (`tenantId`, `leadId`, `userId`, `dialerCallId`, `result`, `note`, `at`, `createdAt`)
SELECT `tenantId`, `leadId`, `agentUserId`, `id`,
	CASE `status` WHEN 'beendet' THEN 'erreicht' WHEN 'besetzt' THEN 'besetzt' WHEN 'anrufbeantworter' THEN 'mailbox' ELSE 'nicht_erreicht' END,
	NULL, `startedAt`, `startedAt`
FROM `dialerCalls`
WHERE `leadId` IS NOT NULL AND `status` IN ('beendet','besetzt','keine_antwort','anrufbeantworter','abgebrochen','fehlgeschlagen');
