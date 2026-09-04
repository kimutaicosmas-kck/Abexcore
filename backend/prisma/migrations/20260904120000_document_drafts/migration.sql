-- Allow in-progress quotation drafts without a customer yet.
ALTER TABLE `sales_quotations` MODIFY `customer_id` VARCHAR(191) NULL;

-- Invoice drafts (excluded from AR/AP until finalized).
ALTER TABLE `invoices` MODIFY `status` ENUM('DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'REFUNDED') NOT NULL DEFAULT 'UNPAID';

CREATE INDEX `sales_quotations_status_idx` ON `sales_quotations`(`status`);

-- Track who created quotations/invoices for PDF accountability.
ALTER TABLE `sales_quotations` ADD COLUMN `created_by_id` VARCHAR(191) NULL;
ALTER TABLE `sales_quotations` ADD CONSTRAINT `sales_quotations_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `invoices` ADD COLUMN `created_by_id` VARCHAR(191) NULL;
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Generic in-progress form drafts for all modules.
CREATE TABLE `form_drafts` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `module_key` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `form_drafts_company_id_user_id_module_key_key`(`company_id`, `user_id`, `module_key`),
    INDEX `form_drafts_company_id_user_id_idx`(`company_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `form_drafts` ADD CONSTRAINT `form_drafts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
