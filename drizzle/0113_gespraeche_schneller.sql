CREATE INDEX `call_records_tenant_started_idx` ON `callRecords` (`tenantId`,`startedAt`,`agentName`,`decision`,`score`,`durationSeconds`,`verdict`,`campaign`);--> statement-breakpoint
CREATE INDEX `call_records_tenant_decision_idx` ON `callRecords` (`tenantId`,`decision`,`agentName`);--> statement-breakpoint
CREATE INDEX `dialer_calls_record_idx` ON `dialerCalls` (`callRecordId`);