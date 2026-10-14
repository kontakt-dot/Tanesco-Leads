CREATE TABLE `invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('admin','manager','vertrieb','support','viewer') NOT NULL DEFAULT 'viewer',
	`teamId` int,
	`token` varchar(96) NOT NULL,
	`status` enum('ausstehend','angenommen','widerrufen','abgelaufen') NOT NULL DEFAULT 'ausstehend',
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `marketplacePriceHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`offerId` int NOT NULL,
	`previousPrice` decimal(12,2),
	`newPrice` decimal(12,2) NOT NULL,
	`changedByUserId` int,
	`changedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplacePriceHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketplacePurchases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`offerId` int NOT NULL,
	`buyerName` varchar(160) NOT NULL,
	`purchasePrice` decimal(12,2) NOT NULL,
	`status` enum('bezahlt','erstattet','storniert') NOT NULL DEFAULT 'bezahlt',
	`purchasedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplacePurchases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`email` varchar(320),
	`status` enum('aktiv','inaktiv') NOT NULL DEFAULT 'aktiv',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_tenant_name_unique` UNIQUE(`tenantId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `automationRules` ADD `supplierId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `supplierId` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `supplierId` int;--> statement-breakpoint
CREATE INDEX `invitation_tenant_status_idx` ON `invitations` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `marketplace_price_offer_idx` ON `marketplacePriceHistory` (`offerId`);--> statement-breakpoint
CREATE INDEX `marketplace_purchase_tenant_idx` ON `marketplacePurchases` (`tenantId`);