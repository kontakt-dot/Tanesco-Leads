ALTER TABLE `outboundMessages` MODIFY COLUMN `leadId` int;--> statement-breakpoint
ALTER TABLE `outboundMessages` ADD `inboxMessageId` int;--> statement-breakpoint
CREATE INDEX `outbound_messages_to_idx` ON `outboundMessages` (`tenantId`,`toAddress`);