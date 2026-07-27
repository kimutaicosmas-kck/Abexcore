-- Per-user module access overrides (editable after user creation)
ALTER TABLE `users` ADD COLUMN `allowed_modules` JSON NULL;
