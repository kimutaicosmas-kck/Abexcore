-- Operating expenses module
CREATE TABLE `expenses` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `expense_number` VARCHAR(191) NOT NULL,
    `expense_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `category_account_id` VARCHAR(191) NOT NULL,
    `payee_name` VARCHAR(191) NOT NULL,
    `supplier_id` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `vat_amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_amount` DECIMAL(15, 2) NOT NULL,
    `payment_method` VARCHAR(191) NOT NULL DEFAULT 'CASH',
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED', 'VOIDED') NOT NULL DEFAULT 'DRAFT',
    `receipt_url` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `rejection_reason` TEXT NULL,
    `submitted_by_id` VARCHAR(191) NOT NULL,
    `approved_by_id` VARCHAR(191) NULL,
    `approved_at` DATETIME(3) NULL,
    `posted_at` DATETIME(3) NULL,
    `journal_entry_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `expenses_company_id_expense_number_key`(`company_id`, `expense_number`),
    INDEX `expenses_company_id_status_expense_date_idx`(`company_id`, `status`, `expense_date`),
    INDEX `expenses_category_account_id_idx`(`category_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `expenses` ADD CONSTRAINT `expenses_category_account_id_fkey` FOREIGN KEY (`category_account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_submitted_by_id_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
