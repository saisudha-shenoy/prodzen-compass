-- Adds an optional reason alongside "not helpful" feedback on Ask answers,
-- captured from a small set of preset options or free text. Nullable and
-- unconstrained: "helpful" feedback never sets it, and any non-empty string
-- is accepted (preset labels and free text share the same column).
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS feedback_reason text;
