-- NAGARSETU 3.1 Migration: Operational, Audit, Blockchain, and Compatibility Tables
-- Adds missing tables identified in ERROR-011 and ERROR-012

-- 1. Feedback Compatibility View
CREATE OR REPLACE VIEW public.feedback AS
SELECT 
    id,
    complaint_id,
    rating,
    comment,
    created_at
FROM public.complaint_feedback;

-- 2. Announcements Table
CREATE TABLE IF NOT EXISTS public.announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT DEFAULT 'Medium',
    target_audience TEXT DEFAULT 'all_departments',
    target_role TEXT,
    department_id UUID REFERENCES public.departments(id),
    department_name TEXT,
    created_by TEXT DEFAULT 'City Admin',
    posted_by TEXT DEFAULT 'City Admin',
    created_by_role TEXT DEFAULT 'city_admin',
    is_published INT DEFAULT 1,
    published_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Announcements read policy" ON public.announcements
    FOR SELECT TO authenticated, anon
    USING (is_published = 1);

CREATE POLICY "Announcements admin manage policy" ON public.announcements
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p 
            WHERE p.id = auth.uid() AND p.role IN ('city_admin', 'super_admin')
        )
    );

-- 3. Announcement Reads Table
CREATE TABLE IF NOT EXISTS public.announcement_reads (
    id SERIAL PRIMARY KEY,
    announcement_id INT NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    read_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    UNIQUE(announcement_id, user_id)
);

ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Announcement reads user manage" ON public.announcement_reads
    FOR ALL TO authenticated
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

-- 4. Recurring Issue Links Table
CREATE TABLE IF NOT EXISTS public.recurring_issue_links (
    id SERIAL PRIMARY KEY,
    current_complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
    previous_complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'Potential',
    distance_meters NUMERIC,
    department_id UUID REFERENCES public.departments(id),
    detected_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    UNIQUE(current_complaint_id, previous_complaint_id)
);

CREATE INDEX IF NOT EXISTS idx_recurring_current ON public.recurring_issue_links(current_complaint_id);
CREATE INDEX IF NOT EXISTS idx_recurring_previous ON public.recurring_issue_links(previous_complaint_id);

ALTER TABLE public.recurring_issue_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recurring issue links view policy" ON public.recurring_issue_links
    FOR SELECT TO authenticated
    USING (true);

-- 5. Super Admin Audit Logs Table
CREATE TABLE IF NOT EXISTS public.super_admin_audit_logs (
    id SERIAL PRIMARY KEY,
    admin_id TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    changes_json TEXT,
    reason TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_admin ON public.super_admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_target ON public.super_admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.super_admin_audit_logs(created_at);

ALTER TABLE public.super_admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin audit logs restricted access" ON public.super_admin_audit_logs
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p 
            WHERE p.id = auth.uid() AND p.role = 'super_admin'
        )
    );

-- 6. Complaint Evidence Versions Table
CREATE TABLE IF NOT EXISTS public.complaint_evidence_versions (
    id SERIAL PRIMARY KEY,
    complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
    version_number INT NOT NULL DEFAULT 1,
    photo_before_url TEXT,
    photo_after_url TEXT,
    photo_front_url TEXT,
    replacement_reason TEXT,
    replaced_by TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_evidence_complaint ON public.complaint_evidence_versions(complaint_id);

ALTER TABLE public.complaint_evidence_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Evidence versions view policy" ON public.complaint_evidence_versions
    FOR SELECT TO authenticated
    USING (true);

-- 7. Blockchain Blocks Table
CREATE TABLE IF NOT EXISTS public.blockchain_blocks (
    id SERIAL PRIMARY KEY,
    block_number BIGINT UNIQUE NOT NULL,
    previous_block_hash TEXT NOT NULL,
    block_hash TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    transaction_count INT NOT NULL DEFAULT 0,
    validator_node TEXT NOT NULL DEFAULT 'NASHIK-MUNICIPAL-ORACLE-01',
    validator_signature TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_blockchain_blocks_number ON public.blockchain_blocks(block_number);

-- 8. Blockchain Transactions Table (Anchoring Outbox Queue)
CREATE TABLE IF NOT EXISTS public.blockchain_transactions (
    id SERIAL PRIMARY KEY,
    tx_id TEXT UNIQUE NOT NULL,
    block_number BIGINT REFERENCES public.blockchain_blocks(block_number),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    commitment_hash TEXT NOT NULL,
    previous_commitment_hash TEXT,
    metadata_json TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_blockchain_tx_entity ON public.blockchain_transactions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_tx_status ON public.blockchain_transactions(status);

ALTER TABLE public.blockchain_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blockchain_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Blockchain blocks public verify" ON public.blockchain_blocks
    FOR SELECT TO authenticated, anon
    USING (true);

CREATE POLICY "Blockchain transactions public verify" ON public.blockchain_transactions
    FOR SELECT TO authenticated, anon
    USING (true);
