-- Salary advances with monthly payroll recovery

ALTER TABLE `payroll_records`
  ADD COLUMN `advance_deduction` DECIMAL(15, 2) NOT NULL DEFAULT 0;

CREATE TABLE `salary_advances` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `advance_no` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `monthly_deduction` DECIMAL(15, 2) NOT NULL,
    `remaining_balance` DECIMAL(15, 2) NOT NULL,
    `total_repaid` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `installments` INT NOT NULL DEFAULT 1,
    `reason` TEXT NULL,
    `notes` TEXT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'WRITTEN_OFF') NOT NULL DEFAULT 'PENDING',
    `deduction_start_date` DATE NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approved_at` DATETIME(3) NULL,
    `approved_by_id` VARCHAR(191) NULL,
    `rejected_at` DATETIME(3) NULL,
    `rejection_reason` TEXT NULL,
    `disbursed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` TEXT NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `salary_advances_company_id_advance_no_key`(`company_id`, `advance_no`),
    INDEX `salary_advances_company_id_status_idx`(`company_id`, `status`),
    INDEX `salary_advances_employee_id_status_idx`(`employee_id`, `status`),
    CONSTRAINT `salary_advances_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `salary_advances_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `salary_advances_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `salary_advance_repayments` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `advance_id` VARCHAR(191) NOT NULL,
    `payroll_record_id` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `method` ENUM('PAYROLL', 'CASH', 'BANK_TRANSFER', 'MPESA', 'MANUAL') NOT NULL DEFAULT 'PAYROLL',
    `is_applied` BOOLEAN NOT NULL DEFAULT false,
    `paid_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `recorded_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `salary_advance_repayments_payroll_record_id_advance_id_key`(`payroll_record_id`, `advance_id`),
    INDEX `salary_advance_repayments_company_id_advance_id_idx`(`company_id`, `advance_id`),
    INDEX `salary_advance_repayments_payroll_record_id_idx`(`payroll_record_id`),
    CONSTRAINT `salary_advance_repayments_advance_id_fkey` FOREIGN KEY (`advance_id`) REFERENCES `salary_advances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `salary_advance_repayments_payroll_record_id_fkey` FOREIGN KEY (`payroll_record_id`) REFERENCES `payroll_records`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `salary_advance_repayments_recorded_by_id_fkey` FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
