/**
 * Listen-Marker „Liste: <Name>“.
 * Beim Hochladen einer Liste hängt die Software diesen Marker an jeden Kontakt der Liste – daran erkennt sie später, wer zu welcher
 * Liste gehört (Anrufkampagne einer Liste, Kontakt in zwei Listen). Der Marker ist kein Tag für Menschen: In der Tag-Verwaltung und in
 * der Tag-Auswahl am Lead taucht er nicht auf, und von Hand lässt sich kein Tag mit diesem Anfang anlegen.
 */
export const LIST_TAG_PREFIX = "Liste: ";
export const isListTag = (name: string | null | undefined): boolean => String(name ?? "").startsWith(LIST_TAG_PREFIX);
export const LIST_TAG_RESERVED = "Namen, die mit „Liste: “ beginnen, vergibt die Software selbst für hochgeladene Listen. Bitte einen anderen Namen wählen.";
