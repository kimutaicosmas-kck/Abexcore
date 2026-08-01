-- Customer VAT vs Non-VAT classification (mandatory on create going forward).
ALTER TABLE `customers`
  ADD COLUMN `vat_status` ENUM('VAT', 'NON_VAT') NOT NULL DEFAULT 'NON_VAT';

-- Existing customers with a tax PIN are treated as VAT-registered.
UPDATE `customers`
SET `vat_status` = 'VAT'
WHERE `tax_pin` IS NOT NULL AND TRIM(`tax_pin`) <> '';

CREATE INDEX `customers_vat_status_idx` ON `customers`(`vat_status`);
