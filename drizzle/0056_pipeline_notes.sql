CREATE TABLE `pipelineNotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`authorUserId` int,
	`text` text NOT NULL,
	`source` enum('text','sprache') NOT NULL DEFAULT 'text',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pipelineNotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `pipeline_notes_lead_idx` ON `pipelineNotes` (`tenantId`,`leadId`);