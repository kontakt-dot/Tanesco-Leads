CREATE TABLE `automationRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`triggerType` enum('lead_erstellt','reklamation_genehmigt','status_geändert') NOT NULL DEFAULT 'lead_erstellt',
	`sourceCategoryId` int NOT NULL,
	`targetCategoryId` int NOT NULL,
	`conditionMode` enum('alle','mindestens_eine') NOT NULL DEFAULT 'alle',
	`conditions` json,
	`supplierFilter` json,
	`status` enum('aktiv','pausiert') NOT NULL DEFAULT 'pausiert',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automationRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`reason` varchar(160) NOT NULL,
	`details` text,
	`status` enum('offen','in_prüfung','genehmigt','abgelehnt') NOT NULL DEFAULT 'offen',
	`refundAmount` decimal(12,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deliveryChains` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`categoryId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`priority` int NOT NULL DEFAULT 1,
	`sellTarget` int NOT NULL DEFAULT 1,
	`distributionMode` enum('lieferketten_round_robin','bestellungen_round_robin') NOT NULL DEFAULT 'lieferketten_round_robin',
	`status` enum('aktiv','inaktiv') NOT NULL DEFAULT 'inaktiv',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deliveryChains_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deliveryStops` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chainId` int NOT NULL,
	`buyerName` varchar(160) NOT NULL,
	`position` int NOT NULL,
	`unitPrice` decimal(12,2) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deliveryStops_id` PRIMARY KEY(`id`),
	CONSTRAINT `delivery_stop_position_unique` UNIQUE(`chainId`,`position`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`invoiceNumber` varchar(36) NOT NULL,
	`recipientName` varchar(160) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`status` enum('entwurf','offen','bezahlt','überfällig','storniert') NOT NULL DEFAULT 'entwurf',
	`dueAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_tenant_number_unique` UNIQUE(`tenantId`,`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `leadCategories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`shortcode` varchar(32) NOT NULL,
	`name` varchar(160) NOT NULL,
	`multisaleMax` int NOT NULL DEFAULT 1,
	`defaultLeadPrice` decimal(12,2),
	`geocodingRequired` boolean NOT NULL DEFAULT true,
	`marketplaceEnabled` boolean NOT NULL DEFAULT false,
	`pipelineType` enum('Sales-Pipeline','Partner-Pipeline','Direktvertrieb') NOT NULL DEFAULT 'Sales-Pipeline',
	`offerDescription` text,
	`status` enum('aktiv','inaktiv') NOT NULL DEFAULT 'aktiv',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leadCategories_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_category_tenant_shortcode_unique` UNIQUE(`tenantId`,`shortcode`)
);
--> statement-breakpoint
CREATE TABLE `leadTagAssignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`tagId` int NOT NULL,
	CONSTRAINT `leadTagAssignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_tag_unique` UNIQUE(`leadId`,`tagId`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`publicId` varchar(12) NOT NULL,
	`categoryId` int NOT NULL,
	`firstName` varchar(120),
	`lastName` varchar(120),
	`email` varchar(320),
	`phone` varchar(48),
	`postcode` varchar(24),
	`city` varchar(120),
	`country` varchar(2) NOT NULL DEFAULT 'DE',
	`supplierName` varchar(160),
	`status` enum('neu','genehmigt','zugewiesen','reklamiert','fehlerhaft','deaktiviert','hängend') NOT NULL DEFAULT 'neu',
	`cost` decimal(12,2) NOT NULL DEFAULT '0.00',
	`metadata` json,
	`assignedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_tenant_public_id_unique` UNIQUE(`tenantId`,`publicId`)
);
--> statement-breakpoint
CREATE TABLE `marketplaceOffers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`leadId` int NOT NULL,
	`categoryId` int NOT NULL,
	`listPrice` decimal(12,2) NOT NULL,
	`status` enum('aktiv','verkauft','entfernt') NOT NULL DEFAULT 'aktiv',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplaceOffers_id` PRIMARY KEY(`id`),
	CONSTRAINT `offer_tenant_lead_unique` UNIQUE(`tenantId`,`leadId`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`userId` int NOT NULL,
	`teamId` int,
	`role` enum('inhaber','admin','manager','vertrieb','support','viewer') NOT NULL DEFAULT 'viewer',
	`status` enum('aktiv','eingeladen','deaktiviert') NOT NULL DEFAULT 'eingeladen',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `membership_tenant_user_unique` UNIQUE(`tenantId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`orderNumber` varchar(36) NOT NULL,
	`buyerName` varchar(160) NOT NULL,
	`categoryId` int NOT NULL,
	`quantity` int NOT NULL,
	`deliveredCount` int NOT NULL DEFAULT 0,
	`unitPrice` decimal(12,2) NOT NULL,
	`status` enum('offen','aktiv','erfüllt','pausiert','storniert') NOT NULL DEFAULT 'offen',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_tenant_number_unique` UNIQUE(`tenantId`,`orderNumber`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`categoryId` int,
	`price` decimal(12,2) NOT NULL,
	`status` enum('aktiv','inaktiv') NOT NULL DEFAULT 'aktiv',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supportTickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`ticketNumber` varchar(36) NOT NULL,
	`subject` varchar(240) NOT NULL,
	`requesterName` varchar(160) NOT NULL,
	`priority` enum('niedrig','normal','hoch','dringend') NOT NULL DEFAULT 'normal',
	`status` enum('offen','in_bearbeitung','gelöst','geschlossen') NOT NULL DEFAULT 'offen',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supportTickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `ticket_tenant_number_unique` UNIQUE(`tenantId`,`ticketNumber`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`color` varchar(12) NOT NULL DEFAULT '#2DD4BF',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tag_tenant_name_unique` UNIQUE(`tenantId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`color` varchar(12) NOT NULL DEFAULT '#8B5CF6',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `teams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(96) NOT NULL,
	`name` varchar(160) NOT NULL,
	`locale` varchar(12) NOT NULL DEFAULT 'de-DE',
	`currency` varchar(3) NOT NULL DEFAULT 'EUR',
	`timezone` varchar(64) NOT NULL DEFAULT 'Europe/Berlin',
	`logoUrl` text,
	`primaryColor` varchar(12) NOT NULL DEFAULT '#635BFF',
	`marketplaceEnabled` boolean NOT NULL DEFAULT false,
	`reclamationRule` enum('keep','relist') NOT NULL DEFAULT 'keep',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE INDEX `automation_tenant_idx` ON `automationRules` (`tenantId`);--> statement-breakpoint
CREATE INDEX `claim_tenant_status_idx` ON `claims` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `chain_tenant_category_idx` ON `deliveryChains` (`tenantId`,`categoryId`);--> statement-breakpoint
CREATE INDEX `invoice_tenant_status_idx` ON `invoices` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `lead_category_tenant_idx` ON `leadCategories` (`tenantId`);--> statement-breakpoint
CREATE INDEX `lead_tenant_status_idx` ON `leads` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `lead_tenant_category_idx` ON `leads` (`tenantId`,`categoryId`);--> statement-breakpoint
CREATE INDEX `offer_tenant_status_idx` ON `marketplaceOffers` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `membership_tenant_idx` ON `memberships` (`tenantId`);--> statement-breakpoint
CREATE INDEX `order_tenant_status_idx` ON `orders` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `product_tenant_idx` ON `products` (`tenantId`);--> statement-breakpoint
CREATE INDEX `ticket_tenant_status_idx` ON `supportTickets` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `team_tenant_idx` ON `teams` (`tenantId`);