-- Optional sales-person ownership on customers
ALTER TABLE `customers`
  ADD COLUMN `sales_person_id` VARCHAR(191) NULL;

CREATE INDEX `customers_sales_person_id_idx` ON `customers`(`sales_person_id`);

ALTER TABLE `customers`
  ADD CONSTRAINT `customers_sales_person_id_fkey`
  FOREIGN KEY (`sales_person_id`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
