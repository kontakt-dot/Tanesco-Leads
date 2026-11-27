-- Immer in Echtzeit (v391): Jede Bestellung liefert sofort nach der Freigabe – es gibt kein gesammeltes Liefern („einmal am Tag“) mehr.
-- Bestehende Bestellungen werden umgestellt; Leads, die auf ein Tagesfenster gewartet haben, holt der Zeitplaner beim nächsten Lauf nach.
UPDATE `orderOperationalConfigs` SET `realtimeDelivery` = true, `deliveryInterval` = 'sofort';--> statement-breakpoint
ALTER TABLE `orderOperationalConfigs` MODIFY COLUMN `deliveryInterval` enum('sofort','täglich','wöchentlich','monatlich') NOT NULL DEFAULT 'sofort';--> statement-breakpoint
-- Leadsparten einer Bestellung, die sich eine Kette teilen (v391, „Für welche Sparten gilt diese Kette?“ → Speichern): gleiche Zahl = gemeinsame
-- Kette (die kleinste Ketten-Nummer der Gruppe). Leer = noch nie gespeichert – dann gelten Ketten mit denselben Stationen als gemeinsam.
ALTER TABLE `deliveryChains` ADD `linkGroup` int;
