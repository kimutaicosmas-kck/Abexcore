-- AlterEnum: add DELIVERY notification type for driver trip assignments
ALTER TABLE `notifications` MODIFY `type` ENUM('APPROVAL', 'LOW_STOCK', 'OVERDUE_PAYMENT', 'PRODUCTION_DELAY', 'MAINTENANCE', 'DELIVERY', 'SYSTEM') NOT NULL;
