-- Ledger traceability: link journal entries to source documents and reversals
ALTER TABLE `journal_entries`
  ADD COLUMN `source_type` VARCHAR(64) NULL AFTER `reference`,
  ADD COLUMN `source_id` VARCHAR(36) NULL AFTER `source_type`,
  ADD COLUMN `reversal_of_id` VARCHAR(36) NULL AFTER `source_id`;

CREATE INDEX `journal_entries_source_idx` ON `journal_entries` (`company_id`, `source_type`, `source_id`);
CREATE INDEX `journal_entries_reversal_idx` ON `journal_entries` (`reversal_of_id`);
