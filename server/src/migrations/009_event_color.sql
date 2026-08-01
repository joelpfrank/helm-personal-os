-- Per-event display color. Google Calendar events have a `colorId`
-- that maps to a fixed 11-color palette; we resolve it to a hex string
-- at sync time so the frontend can render a colored chip/border
-- without re-querying Google. Null = use the calendar's default
-- (which we render as --accent).

ALTER TABLE events ADD COLUMN color TEXT;
