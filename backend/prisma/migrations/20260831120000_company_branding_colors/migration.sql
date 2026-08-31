-- Per-company brand and document stationery colors (platform owner configures)
ALTER TABLE `companies` ADD COLUMN `brand_primary` VARCHAR(7) NULL;
ALTER TABLE `companies` ADD COLUMN `brand_accent` VARCHAR(7) NULL;
ALTER TABLE `companies` ADD COLUMN `doc_primary_color` VARCHAR(7) NULL;
