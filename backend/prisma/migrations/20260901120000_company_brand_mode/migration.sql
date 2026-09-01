-- Tenant design: AbexCore default look vs unique/auto-generated palette
ALTER TABLE `companies` ADD COLUMN `brand_mode` VARCHAR(20) NOT NULL DEFAULT 'unique';
