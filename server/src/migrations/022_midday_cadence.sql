-- Midday Recalibration: the third beat of the daily rhythm.
--
-- Morning sets the must-win, midday checks whether reality agreed, evening
-- closes the day out. Without the midday beat the user only discovers a
-- derailed day at 9pm, when nothing can be done about it.
--
-- Strictly ADDITIVE. Two new columns on the single-row coach_settings table,
-- each with a default, so existing rows keep every cadence value they already
-- had (morning/evening times, weekly day, enable flags) and simply gain a
-- midday cadence that is on by default at 13:00 — early enough to still
-- salvage an afternoon, late enough that the morning's plan has been tested.
--
-- No data is rewritten, no column is dropped, no check-in is touched.
ALTER TABLE coach_settings ADD COLUMN midday_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE coach_settings ADD COLUMN midday_time    TEXT    NOT NULL DEFAULT '13:00';
