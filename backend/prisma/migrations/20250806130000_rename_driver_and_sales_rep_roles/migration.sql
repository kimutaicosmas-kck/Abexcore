-- Rename display roles (users keep the same role_id; only the role name changes).
UPDATE `roles` SET `name` = 'Sales Executive' WHERE `name` = 'Sales Representative';
UPDATE `roles` SET `name` = 'Logistics & Delivery' WHERE `name` = 'Driver';
