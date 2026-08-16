-- Drops every user's stored language choice. The data is not recoverable
-- from anywhere else (no audit projection reconstructs it), but it is also
-- purely a display preference: on re-apply, users fall back to device-locale
-- negotiation and simply re-choose. No backup table is warranted.
ALTER TABLE "User" DROP COLUMN IF EXISTS "preferred_language";
