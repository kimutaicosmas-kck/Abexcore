-- Gender on employees + per-year leave balances
CREATE TABLE IF NOT EXISTS `leave_balances` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `entitled_days` DECIMAL(8, 1) NOT NULL,
    `used_days` DECIMAL(8, 1) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `updated_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `leave_balances_employee_id_year_type_key` ON `leave_balances`(`employee_id`, `year`, `type`);
CREATE INDEX `leave_balances_company_id_year_idx` ON `leave_balances`(`company_id`, `year`);

ALTER TABLE `leave_balances`
  ADD CONSTRAINT `leave_balances_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `leave_balances`
  ADD CONSTRAINT `leave_balances_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Gender enum column (MySQL)
ALTER TABLE `employees`
  ADD COLUMN `gender` ENUM('MALE', 'FEMALE', 'UNSPECIFIED') NOT NULL DEFAULT 'UNSPECIFIED';
