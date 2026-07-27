-- Tenant isolation hardening: direct companyId on indirect models
-- Opportunities
ALTER TABLE `opportunities` ADD COLUMN `company_id` VARCHAR(36) NULL;
UPDATE `opportunities` o
INNER JOIN `customers` c ON o.customer_id = c.id
SET o.company_id = c.company_id;
ALTER TABLE `opportunities` MODIFY `company_id` VARCHAR(36) NOT NULL;
ALTER TABLE `opportunities` ADD CONSTRAINT `opportunities_company_id_fkey`
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX `opportunities_company_id_idx` ON `opportunities`(`company_id`);

-- Complaints
ALTER TABLE `complaints` ADD COLUMN `company_id` VARCHAR(36) NULL;
UPDATE `complaints` co
INNER JOIN `customers` c ON co.customer_id = c.id
SET co.company_id = c.company_id;
ALTER TABLE `complaints` MODIFY `company_id` VARCHAR(36) NOT NULL;
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_company_id_fkey`
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX `complaints_company_id_idx` ON `complaints`(`company_id`);

-- Quality inspections
ALTER TABLE `quality_inspections` ADD COLUMN `company_id` VARCHAR(36) NULL;
UPDATE `quality_inspections` qi
LEFT JOIN `production_orders` po ON qi.production_order_id = po.id
LEFT JOIN `goods_receipts` gr ON qi.goods_receipt_id = gr.id
LEFT JOIN `products` p ON qi.product_id = p.id
SET qi.company_id = COALESCE(po.company_id, gr.company_id, p.company_id);
UPDATE `quality_inspections` SET `company_id` = (SELECT id FROM companies WHERE slug = 'owner' LIMIT 1)
WHERE `company_id` IS NULL;
ALTER TABLE `quality_inspections` MODIFY `company_id` VARCHAR(36) NOT NULL;
ALTER TABLE `quality_inspections` ADD CONSTRAINT `quality_inspections_company_id_fkey`
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX `quality_inspections_company_id_idx` ON `quality_inspections`(`company_id`);
ALTER TABLE `quality_inspections` DROP INDEX `quality_inspections_inspection_no_key`;
ALTER TABLE `quality_inspections` ADD UNIQUE INDEX `quality_inspections_company_id_inspection_no_key` (`company_id`, `inspection_no`);

-- Delivery notes
ALTER TABLE `delivery_notes` ADD COLUMN `company_id` VARCHAR(36) NULL;
UPDATE `delivery_notes` dn
INNER JOIN `sales_orders` so ON dn.sales_order_id = so.id
SET dn.company_id = so.company_id;
ALTER TABLE `delivery_notes` MODIFY `company_id` VARCHAR(36) NOT NULL;
ALTER TABLE `delivery_notes` ADD CONSTRAINT `delivery_notes_company_id_fkey`
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX `delivery_notes_company_id_idx` ON `delivery_notes`(`company_id`);
ALTER TABLE `delivery_notes` DROP INDEX `delivery_notes_delivery_no_key`;
ALTER TABLE `delivery_notes` ADD UNIQUE INDEX `delivery_notes_company_id_delivery_no_key` (`company_id`, `delivery_no`);
