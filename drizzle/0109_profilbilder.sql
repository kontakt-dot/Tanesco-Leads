CREATE TABLE `userAvatars` (
	`userId` int NOT NULL,
	`mime` varchar(32) NOT NULL,
	`data` mediumtext NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userAvatars_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `avatarKey` varchar(40);