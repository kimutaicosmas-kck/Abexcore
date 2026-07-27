-- CreateTable
CREATE TABLE `delivery_trips` (
    `id` VARCHAR(191) NOT NULL,
    `trip_no` VARCHAR(191) NOT NULL,
    `vehicle_id` VARCHAR(191) NULL,
    `driver_id` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED') NOT NULL DEFAULT 'PENDING',
    `scheduled_date` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `delivery_trips_trip_no_key`(`trip_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `delivery_notes` ADD COLUMN `delivery_trip_id` VARCHAR(191) NULL,
    ADD COLUMN `stop_sequence` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `delivery_trips` ADD CONSTRAINT `delivery_trips_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_trips` ADD CONSTRAINT `delivery_trips_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_notes` ADD CONSTRAINT `delivery_notes_delivery_trip_id_fkey` FOREIGN KEY (`delivery_trip_id`) REFERENCES `delivery_trips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
