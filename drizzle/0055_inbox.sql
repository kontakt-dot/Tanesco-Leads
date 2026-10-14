CREATE TABLE `inboxMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`messageId` varchar(320) NOT NULL,
	`imapUid` int,
	`fromEmail` varchar(320) NOT NULL,
	`fromName` varchar(200),
	`subject` varchar(400),
	`bodyText` text,
	`receivedAt` timestamp NOT NULL,
	`isRead` boolean NOT NULL DEFAULT false,
	`campaignRecipientId` int,
	`leadId` int,
	`archived` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inboxMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbox_message_unique` UNIQUE(`tenantId`,`messageId`)
);
--> statement-breakpoint
CREATE INDEX `inbox_tenant_idx` ON `inboxMessages` (`tenantId`,`receivedAt`);