-- Der Dialer als Lieferant: Leads aus der Liste „Kontakte vom Dialer“ hatten den Lieferanten nur als Namen („OnDialer“), ohne echten Lieferanten –
-- so ließ er sich in Bestellungen und Lieferketten nicht auswählen. Je Mandant einen Lieferanten mit dem Namen der Quelle anlegen (falls es ihn noch nicht gibt),
-- die Liste damit verknüpfen und die schon übernommenen Leads der Liste ebenso.
INSERT INTO `suppliers` (`tenantId`, `name`, `status`) SELECT DISTINCT b.`tenantId`, b.`sourceName`, 'aktiv' FROM `rawBatches` b WHERE JSON_UNQUOTE(JSON_EXTRACT(b.`mapping`, '$.auto')) = 'dialer' AND b.`supplierId` IS NULL AND b.`sourceName` IS NOT NULL AND b.`sourceName` <> '' AND NOT EXISTS (SELECT 1 FROM `suppliers` s WHERE s.`tenantId` = b.`tenantId` AND LOWER(s.`name`) = LOWER(b.`sourceName`));
--> statement-breakpoint
UPDATE `rawBatches` b JOIN `suppliers` s ON s.`tenantId` = b.`tenantId` AND LOWER(s.`name`) = LOWER(b.`sourceName`) SET b.`supplierId` = s.`id` WHERE JSON_UNQUOTE(JSON_EXTRACT(b.`mapping`, '$.auto')) = 'dialer' AND b.`supplierId` IS NULL;
--> statement-breakpoint
UPDATE `leads` l JOIN `rawContacts` c ON c.`leadId` = l.`id` JOIN `rawBatches` b ON b.`id` = c.`batchId` JOIN `suppliers` s ON s.`id` = b.`supplierId` SET l.`supplierId` = s.`id`, l.`supplierName` = s.`name` WHERE l.`supplierId` IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(b.`mapping`, '$.auto')) = 'dialer';
