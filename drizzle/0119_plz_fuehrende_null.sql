-- PLZ ohne führende Null (z. B. „9633“ statt „09633“ – aus dem Dialer, der die PLZ als Zahl speichert, oder aus einer Excel-Liste):
-- In Deutschland hat jede PLZ 5 Ziffern, eine 4-stellige hat ihre Null verloren. Österreich und die Schweiz (4 Ziffern) bleiben, wie sie sind.
-- Je Lead ein Eintrag im Lead-Log mit altem und neuem Wert.
INSERT INTO `leadStatusEvents` (`tenantId`, `leadId`, `previousStatus`, `nextStatus`, `note`) SELECT `tenantId`, `id`, `status`, `status`, CONCAT('PLZ: „', `postcode`, '“ → „0', `postcode`, '“ – die führende Null fehlte (Dialer oder Excel-Liste) und wurde ergänzt') FROM `leads` WHERE `postcode` REGEXP '^[0-9]{4}$' AND (`country` IS NULL OR `country` = '' OR UPPER(`country`) = 'DE');
--> statement-breakpoint
UPDATE `leads` SET `postcode` = CONCAT('0', `postcode`) WHERE `postcode` REGEXP '^[0-9]{4}$' AND (`country` IS NULL OR `country` = '' OR UPPER(`country`) = 'DE');
--> statement-breakpoint
UPDATE `rawContacts` SET `postcode` = CONCAT('0', `postcode`) WHERE `postcode` REGEXP '^[0-9]{4}$' AND (`country` IS NULL OR `country` = '' OR UPPER(`country`) = 'DE');
--> statement-breakpoint
UPDATE `d2dCaptures` SET `postcode` = CONCAT('0', `postcode`) WHERE `postcode` REGEXP '^[0-9]{4}$' AND (`country` IS NULL OR `country` = '' OR UPPER(`country`) = 'DE');
