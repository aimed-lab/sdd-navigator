-- =============================================================================
-- Migration: promote_showcase — STORAGE  (2026-07-26)   [RUN SECOND, OPTIONAL]
-- =============================================================================
-- Public-read bucket for OPTIONAL figure uploads on the showcase.
--
-- IF THIS SCRIPT ERRORS, NOTHING IS BROKEN. Submitting without an image is fully
-- supported — image_url stays NULL and the card renders text-only. It is split
-- out from the core migration precisely so a storage permission error cannot
-- roll back the table.
--
-- Many Supabase projects refuse `CREATE POLICY ... ON storage.objects` from the
-- SQL editor ("must be owner of table objects"). If that happens, do it in the
-- dashboard instead:
--   1. Storage → New bucket → name: showcase-images → Public bucket: ON
--   2. Storage → showcase-images → Policies → add:
--        • SELECT  for anon, authenticated   (no extra condition)
--        • INSERT  for authenticated, condition:
--             (storage.foldername(name))[1] = auth.uid()::text
--        • DELETE  for authenticated, same condition as INSERT
-- The uid-folder condition is what stops one user overwriting another's image;
-- lib/server/showcase.ts always uploads to `<uid>/<random>.<ext>` to match it.
-- =============================================================================

-- ── Storage bucket: showcase-images ───────────────────────────────────────
-- Public-read bucket for OPTIONAL figure uploads. Submitting without an image
-- is fully supported — image_url stays NULL and the card renders text-only.
--
-- If your project restricts DDL on the storage schema, create the bucket in the
-- dashboard instead (Storage → New bucket → name "showcase-images", Public ON)
-- and then run only the three policies below.

INSERT INTO storage.buckets (id, name, public)
VALUES ('showcase-images', 'showcase-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Anyone can read an uploaded figure (the gallery is public).
DROP POLICY IF EXISTS "showcase_images_public_read" ON storage.objects;
CREATE POLICY "showcase_images_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'showcase-images');

-- A signed-in user may upload only INTO THEIR OWN FOLDER — the first path
-- segment must be their uid, e.g. "<uid>/figure.png". That keeps one user from
-- overwriting another's image.
DROP POLICY IF EXISTS "showcase_images_own_insert" ON storage.objects;
CREATE POLICY "showcase_images_own_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'showcase-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "showcase_images_own_delete" ON storage.objects;
CREATE POLICY "showcase_images_own_delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'showcase-images'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );


