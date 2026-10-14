ALTER TABLE `deliveryChains` ADD `orderId` int;--> statement-breakpoint
CREATE INDEX `chain_tenant_order_idx` ON `deliveryChains` (`tenantId`,`orderId`);