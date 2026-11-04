CREATE TABLE `aiUsageDays` (
	`id` int AUTO_INCREMENT NOT NULL,
	`day` varchar(10) NOT NULL,
	`purpose` varchar(40) NOT NULL,
	`calls` int NOT NULL DEFAULT 0,
	`inputTokens` int NOT NULL DEFAULT 0,
	`outputTokens` int NOT NULL DEFAULT 0,
	`cachedTokens` int NOT NULL DEFAULT 0,
	`costMilliCents` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiUsageDays_id` PRIMARY KEY(`id`),
	CONSTRAINT `aiUsageDays_day_purpose` UNIQUE(`day`,`purpose`)
);
--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `aiDailyBudgetCents` int DEFAULT 1000 NOT NULL;