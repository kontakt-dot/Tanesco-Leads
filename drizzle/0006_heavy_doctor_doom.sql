CREATE TABLE `leadDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`chainId` int,
	`stopId` int,
	`orderId` int,
	`buyerName` varchar(160) NOT NULL,
	`unitPrice` decimal(12,2) NOT NULL,
	`result` enum('angeboten','angenommen','abgelehnt','übersprungen') NOT NULL DEFAULT 'angeboten',
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leadDeliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `deliveryChains` ADD `roundRobinCursor` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `lead_delivery_tenant_lead_idx` ON `leadDeliveries` (`tenantId`,`leadId`);--> statement-breakpoint
CREATE INDEX `lead_delivery_chain_idx` ON `leadDeliveries` (`chainId`);