-- Customer's purchase order / LPO reference on sales orders and invoices.
ALTER TABLE `sales_orders`
  ADD COLUMN `customer_po_number` VARCHAR(191) NULL;

ALTER TABLE `invoices`
  ADD COLUMN `customer_po_number` VARCHAR(191) NULL;
