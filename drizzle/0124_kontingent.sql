-- Kontingent je Partnerkonto (v378): „900 Leads je Woche“ – die Statistik „Integrationen“ zeigt daran, wie viele Leads noch nachzuschieben sind
-- (Kontingent − vom Partner angenommene; was er beim Senden ablehnt, weil er den Kontakt schon hat, zählt nicht). Leer = kein Kontingent.
ALTER TABLE `partnerAccounts` ADD `quotaAmount` int;--> statement-breakpoint
ALTER TABLE `partnerAccounts` ADD `quotaPeriod` enum('day','week','month') NOT NULL DEFAULT 'week';
