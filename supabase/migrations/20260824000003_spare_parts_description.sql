-- spare_parts was missing a description column -- the SpareParts.tsx form
-- was already wired up assuming it existed (it doesn't; only products has
-- one). Add it so the Add/Edit Spare Part modal's description field saves.

alter table public.spare_parts add column description text;
