-- Production hardening & Kenya payroll fields
ALTER TABLE `users` ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `employees` ADD COLUMN `kra_pin` VARCHAR(191) NULL;
ALTER TABLE `employees` ADD COLUMN `nhif_no` VARCHAR(191) NULL;
ALTER TABLE `employees` ADD COLUMN `nssf_no` VARCHAR(191) NULL;
ALTER TABLE `payroll_records` ADD COLUMN `paye` DECIMAL(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE `payroll_records` ADD COLUMN `nssf` DECIMAL(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE `payroll_records` ADD COLUMN `shif` DECIMAL(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE `payroll_records` ADD COLUMN `housing_levy` DECIMAL(15, 2) NOT NULL DEFAULT 0;
