-- ============================================================
-- Migration: quotes feature
-- Created: 2026-04-25
-- Environment: Production Supabase
--
-- Run this script once in the Supabase SQL Editor on Prod.
-- All statements are idempotent (IF NOT EXISTS / DROP IF EXISTS).
-- ============================================================


-- ──────────────────────────────────────────────────────────────
-- 1. TABLE: quotes
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id    uuid        NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  quote_number  integer     NOT NULL DEFAULT 1,
  status        text        NOT NULL DEFAULT 'draft',  -- draft | sent | signed
  draft_content jsonb,                                 -- full editable quote data (JSON blob)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);

COMMENT ON TABLE  quotes                  IS 'הצעות מחיר המקושרות לפניות';
COMMENT ON COLUMN quotes.status           IS 'draft | sent | signed';
COMMENT ON COLUMN quotes.draft_content    IS 'תוכן הצעת המחיר הניתן לעריכה — אובייקט JSON חופשי';


-- ──────────────────────────────────────────────────────────────
-- 2. INDEX
-- ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS quotes_inquiry_id_idx ON quotes(inquiry_id);


-- ──────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

-- Authenticated users (studio staff) — full CRUD
DROP POLICY IF EXISTS "authenticated users can do all on quotes" ON quotes;
CREATE POLICY "authenticated users can do all on quotes"
  ON quotes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Anonymous role — SELECT only (required for /quote-print/:quoteId route,
-- which is loaded by the Puppeteer serverless function without an auth token)
DROP POLICY IF EXISTS "anon can select quotes" ON quotes;
CREATE POLICY "anon can select quotes"
  ON quotes
  FOR SELECT
  TO anon
  USING (true);
