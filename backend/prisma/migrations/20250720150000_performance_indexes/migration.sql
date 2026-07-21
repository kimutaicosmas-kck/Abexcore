-- Performance indexes for frequently queried columns
CREATE INDEX `customers_deleted_at_is_active_idx` ON `customers`(`deleted_at`, `is_active`);
CREATE INDEX `customers_name_idx` ON `customers`(`name`);

CREATE INDEX `products_deleted_at_is_active_idx` ON `products`(`deleted_at`, `is_active`);
CREATE INDEX `products_category_idx` ON `products`(`category`);

CREATE INDEX `purchase_orders_status_idx` ON `purchase_orders`(`status`);
CREATE INDEX `purchase_orders_supplier_id_idx` ON `purchase_orders`(`supplier_id`);
CREATE INDEX `purchase_orders_order_date_idx` ON `purchase_orders`(`order_date`);

CREATE INDEX `sales_orders_status_idx` ON `sales_orders`(`status`);
CREATE INDEX `sales_orders_customer_id_idx` ON `sales_orders`(`customer_id`);
CREATE INDEX `sales_orders_order_date_idx` ON `sales_orders`(`order_date`);
CREATE INDEX `sales_orders_sales_person_id_idx` ON `sales_orders`(`sales_person_id`);

CREATE INDEX `invoices_status_idx` ON `invoices`(`status`);
CREATE INDEX `invoices_customer_id_idx` ON `invoices`(`customer_id`);
CREATE INDEX `invoices_invoice_date_idx` ON `invoices`(`invoice_date`);
CREATE INDEX `invoices_due_date_idx` ON `invoices`(`due_date`);
CREATE INDEX `invoices_type_idx` ON `invoices`(`type`);
