-- Allow standalone production/finished inspections (surplus stock QC without production order)
ALTER TABLE `quality_inspections` ADD COLUMN `product_id` VARCHAR(191) NULL;

ALTER TABLE `quality_inspections`
  ADD CONSTRAINT `quality_inspections_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `quality_inspections_product_id_status_idx` ON `quality_inspections`(`product_id`, `status`);
