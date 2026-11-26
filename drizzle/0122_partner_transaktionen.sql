-- Statistik „Integrationen“ (v373): Was aus den gelieferten Leads beim Partner wurde. Je Partnerkonto die Transaktionen des Partners
-- (Status, Provision, Zeitpunkte, Kampagne, Kategorie, Sub-ID, Stornogrund) – eindeutig über Konto und Partner-Nummer, der Abgleich aktualisiert statt zu verdoppeln.
CREATE TABLE `partnerTransactions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` int NOT NULL,
  `accountId` int NOT NULL,
  `externalId` varchar(160) NOT NULL,
  `reference` varchar(160),
  `leadId` int,
  `status` enum('open','confirmed','cancelled') NOT NULL DEFAULT 'open',
  `transactionAt` timestamp NULL,
  `processedAt` timestamp NULL,
  `paidAt` timestamp NULL,
  `commission` decimal(12,2) NOT NULL DEFAULT '0.00',
  `campaignId` varchar(120),
  `campaignName` varchar(240),
  `partnerCategory` varchar(160),
  `subId` varchar(120),
  `cancelReason` varchar(255),
  `raw` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `partnerTransactions_id` PRIMARY KEY(`id`),
  CONSTRAINT `partner_tx_account_external_unique` UNIQUE(`accountId`,`externalId`)
);
--> statement-breakpoint
CREATE INDEX `partner_tx_tenant_account_idx` ON `partnerTransactions` (`tenantId`,`accountId`,`transactionAt`);
--> statement-breakpoint
CREATE INDEX `partner_tx_lead_idx` ON `partnerTransactions` (`tenantId`,`leadId`);
--> statement-breakpoint
-- Weitere Plattformen als Konto anlegbar (Leadnodes, Enpal, GoHighLevel) – und je Konto der Käufer, über den es beliefert wird
ALTER TABLE `partnerAccounts` MODIFY COLUMN `provider` enum('aroundhome','wattfox','hlrlookup','leadnodes','enpal','gohighlevel') NOT NULL;
--> statement-breakpoint
ALTER TABLE `partnerAccounts` ADD `buyerUserId` int;
