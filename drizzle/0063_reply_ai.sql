ALTER TABLE `inboxMessages` ADD `aiKind` varchar(20);--> statement-breakpoint
ALTER TABLE `inboxMessages` ADD `aiConfidence` int;--> statement-breakpoint
ALTER TABLE `inboxMessages` ADD `aiQuote` varchar(300);--> statement-breakpoint
ALTER TABLE `inboxMessages` ADD `aiReason` varchar(200);--> statement-breakpoint
ALTER TABLE `inboxMessages` ADD `aiSource` varchar(10);--> statement-breakpoint
ALTER TABLE `inboxMessages` ADD `aiAction` varchar(20);--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `replyAiEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `replyAiAutoBlock` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `mailSettings` ADD `replyAiInterest` boolean DEFAULT true NOT NULL;