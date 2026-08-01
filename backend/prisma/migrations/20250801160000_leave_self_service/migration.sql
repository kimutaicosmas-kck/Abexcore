-- Link employees to system users; track leave requester/approver.
ALTER TABLE `employees` ADD COLUMN `user_id` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `employees_user_id_key` ON `employees`(`user_id`);
ALTER TABLE `employees` ADD CONSTRAINT `employees_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `leave_requests` ADD COLUMN `requested_by_user_id` VARCHAR(191) NULL;
ALTER TABLE `leave_requests` ADD COLUMN `approved_by_id` VARCHAR(191) NULL;
ALTER TABLE `leave_requests` ADD COLUMN `approved_at` DATETIME(3) NULL;
ALTER TABLE `leave_requests` ADD COLUMN `decision_note` TEXT NULL;

CREATE INDEX `leave_requests_employee_id_status_idx` ON `leave_requests`(`employee_id`, `status`);
CREATE INDEX `leave_requests_requested_by_user_id_idx` ON `leave_requests`(`requested_by_user_id`);

ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
