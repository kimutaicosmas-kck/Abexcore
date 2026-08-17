-- Company package modules (trading vs manufacturing). NULL = full suite (legacy).
ALTER TABLE `companies` ADD COLUMN `enabled_modules` JSON NULL;
