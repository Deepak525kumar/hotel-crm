-- Irreversible by design, and intentionally a no-op.
--
-- The original casing is not recorded anywhere, so it cannot be restored. This
-- is also safe to leave un-reverted: lowercased addresses remain valid and
-- deliverable (the domain part is case-insensitive per RFC 5321, and no mail
-- provider in practice treats the local part case-sensitively), and the code
-- paths that read them all normalize their input.
SELECT 1;
