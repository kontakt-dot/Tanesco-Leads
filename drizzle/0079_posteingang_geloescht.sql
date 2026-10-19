CREATE TABLE `inboxDeletedMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`messageId` varchar(320) NOT NULL,
	`deletedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inboxDeletedMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbox_deleted_unique` UNIQUE(`tenantId`,`messageId`)
);
