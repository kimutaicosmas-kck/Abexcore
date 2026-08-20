-- Faster purge of expired audit rows by created_at
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs`(`created_at`);
