-- AlterTable
ALTER TABLE `companies` ADD COLUMN `storefront_enabled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `vehicles`
  ADD COLUMN `last_lat` DECIMAL(10, 7) NULL,
  ADD COLUMN `last_lng` DECIMAL(10, 7) NULL,
  ADD COLUMN `last_located_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `vehicle_location_pings` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `vehicle_id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `speed_kph` DECIMAL(8, 2) NULL,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vehicle_location_pings_company_id_vehicle_id_recorded_at_idx`(`company_id`, `vehicle_id`, `recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `vehicle_location_pings` ADD CONSTRAINT `vehicle_location_pings_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
