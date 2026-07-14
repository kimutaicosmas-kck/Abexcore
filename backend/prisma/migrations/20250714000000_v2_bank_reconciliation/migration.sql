-- v2.0: Bank reconciliation fields on payments
ALTER TABLE `payments` ADD COLUMN `is_reconciled` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `payments` ADD COLUMN `reconciled_at` DATETIME(3) NULL;
ALTER TABLE `payments` ADD COLUMN `bank_reference` VARCHAR(191) NULL;
