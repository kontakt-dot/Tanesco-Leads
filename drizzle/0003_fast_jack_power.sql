ALTER TABLE `marketplacePurchases` ADD `stripeCheckoutSessionId` varchar(128);--> statement-breakpoint
ALTER TABLE `marketplacePurchases` ADD `stripePaymentIntentId` varchar(128);--> statement-breakpoint
ALTER TABLE `tenants` ADD `stripeCustomerId` varchar(128);