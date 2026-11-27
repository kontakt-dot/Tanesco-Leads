-- Statistik je Käufer von selbst (v383): Ein Käufer mit eigener Schnittstelle erscheint auch ohne Partnerkonto. Trägt man für ihn ein Kontingent
-- ein, braucht es einen Platz dafür – eine Zeile mit dem Anbieter „api“ (keine Rückmeldung, keine Zugangsdaten). Wird später beim Käufer eine
-- Rückmeldung eingerichtet (WattFox, Aroundhome …), wird aus dieser Zeile das Konto des Partners; das Kontingent bleibt.
ALTER TABLE `partnerAccounts` MODIFY COLUMN `provider` enum('aroundhome','wattfox','hlrlookup','leadnodes','enpal','gohighlevel','api') NOT NULL;
