-- Leadmenge einer Bestellung darf leer sein: leer = unbegrenzt (wie „Maximale Leads insgesamt“ der Lieferkette).
ALTER TABLE `orders` MODIFY `quantity` int NULL;
