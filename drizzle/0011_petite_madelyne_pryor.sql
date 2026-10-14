CREATE TABLE `claimEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`claimId` int NOT NULL,
	`eventType` enum('erstellt','frist_gesetzt','status_geändert','entschieden','notiz') NOT NULL,
	`previousStatus` varchar(32),
	`nextStatus` varchar(32),
	`note` text,
	`actorUserId` int,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `claimEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `claim_event_tenant_idx` ON `claimEvents` (`tenantId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `claim_event_claim_idx` ON `claimEvents` (`claimId`,`occurredAt`);