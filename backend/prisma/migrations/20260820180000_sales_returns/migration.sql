-- Post-delivery sales returns: restock + credit note linkage
ALTER TABLE `invoices`
  ADD COLUMN `original_invoice_id` VARCHAR(191) NULL;

CREATE INDEX `invoices_original_invoice_id_idx` ON `invoices`(`original_invoice_id`);

ALTER TABLE `invoices`
  ADD CONSTRAINT `invoices_original_invoice_id_fkey`
  FOREIGN KEY (`original_invoice_id`) REFERENCES `invoices`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `sales_returns` (
  `id` VARCHAR(191) NOT NULL,
  `company_id` VARCHAR(191) NOT NULL,
  `return_no` VARCHAR(191) NOT NULL,
  `sales_order_id` VARCHAR(191) NOT NULL,
  `delivery_note_id` VARCHAR(191) NOT NULL,
  `original_invoice_id` VARCHAR(191) NULL,
  `credit_note_id` VARCHAR(191) NULL,
  `reason` TEXT NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
  `created_by_id` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `sales_returns_credit_note_id_key`(`credit_note_id`),
  UNIQUE INDEX `sales_returns_company_id_return_no_key`(`company_id`, `return_no`),
  INDEX `sales_returns_company_id_idx`(`company_id`),
  INDEX `sales_returns_sales_order_id_idx`(`sales_order_id`),
  INDEX `sales_returns_delivery_note_id_idx`(`delivery_note_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_return_items` (
  `id` VARCHAR(191) NOT NULL,
  `sales_return_id` VARCHAR(191) NOT NULL,
  `product_id` VARCHAR(191) NOT NULL,
  `quantity` INT NOT NULL,
  `unit_price` DECIMAL(15, 2) NOT NULL,
  `total_price` DECIMAL(15, 2) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sales_returns`
  ADD CONSTRAINT `sales_returns_sales_order_id_fkey`
  FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sales_returns`
  ADD CONSTRAINT `sales_returns_delivery_note_id_fkey`
  FOREIGN KEY (`delivery_note_id`) REFERENCES `delivery_notes`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sales_returns`
  ADD CONSTRAINT `sales_returns_original_invoice_id_fkey`
  FOREIGN KEY (`original_invoice_id`) REFERENCES `invoices`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_returns`
  ADD CONSTRAINT `sales_returns_credit_note_id_fkey`
  FOREIGN KEY (`credit_note_id`) REFERENCES `invoices`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `sales_returns`
  ADD CONSTRAINT `sales_returns_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sales_return_items`
  ADD CONSTRAINT `sales_return_items_sales_return_id_fkey`
  FOREIGN KEY (`sales_return_id`) REFERENCES `sales_returns`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sales_return_items`
  ADD CONSTRAINT `sales_return_items_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
