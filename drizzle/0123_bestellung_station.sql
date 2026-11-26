-- Lieferkette aus der Bestellung (v376): Die erste Station einer Bestell-Kette ist die Bestellung selbst – Käufer und Preis kommen von dort.
-- Das Kennzeichen hält sie fest, auch wenn die Bestellung später einen anderen Käufer bekommt. Vorhandene Ketten gleicht die Software beim Start ab.
ALTER TABLE `deliveryStops` ADD `orderStop` boolean NOT NULL DEFAULT false;
