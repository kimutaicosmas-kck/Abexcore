-- Optional waybill / consignment number for hired or third-party transport.
ALTER TABLE `delivery_trips` ADD COLUMN `waybill_no` VARCHAR(191) NULL;
ALTER TABLE `delivery_notes` ADD COLUMN `waybill_no` VARCHAR(191) NULL;
