-- Agenten von Hand löschen (v378): Namen, die aus der Bestenliste genommen wurden (JSON: Name, wann, von wem). Die Gespräche bleiben erhalten;
-- wer zurückgeholt wird, steht wieder mit allen Zahlen in der Liste.
ALTER TABLE `callQaConfigs` ADD `hiddenAgents` json;
