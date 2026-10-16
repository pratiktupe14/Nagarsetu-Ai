-- NAGARSETU Master Supabase PostgreSQL Schema Migration DDL

-- 1. Enable UUID Extension & Types
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
    CREATE TYPE app_role AS ENUM ('citizen', 'city_admin', 'service_staff', 'department_head', 'super_admin');
EXCEPTION
    WHEN duplicate_object THEN
        BEGIN
            ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'super_admin';
        EXCEPTION
            WHEN duplicate_object THEN null;
        END;
END $$;

DO $$ BEGIN
    CREATE TYPE complaint_status_type AS ENUM (
      'Submitted', 'Verified', 'Approved', 'Department Assigned', 
      'Staff Assigned', 'In Progress', 'Accepted', 'On the Way',
      'Resolution Submitted', 'Resolved', 'Reopened', 'Rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE priority_level_type AS ENUM ('Low', 'Medium', 'High', 'Critical');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Departments Table
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed Initial 7 Municipal Departments
INSERT INTO public.departments (name, code, description) VALUES
  ('Public Works Department (PWD)', 'PWD', 'Potholes, asphalt repairs, road damage, public infrastructure'),
  ('Sanitation & Waste Management', 'SAN', 'Garbage collection, overflowing dustbins, street sweeping, solid waste'),
  ('Water Supply & Sewerage Board', 'WTR', 'Water leakage, pipelines, water supply, sewage board'),
  ('Drainage & Sewage Department', 'DRN', 'Drainage blockage, sewage overflow, open drains, monsoon channels'),
  ('Electrical & Street Lighting', 'ELE', 'Streetlights, electrical poles, junction boxes, civic lighting'),
  ('Traffic Management Department', 'TRF', 'Traffic signals, traffic infrastructure, road signage, junctions'),
  ('Maintenance Department', 'MNT', 'General civic facility repairs, building maintenance, public park upkeep')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- 3. Profiles / Users Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  mobile TEXT,
  email TEXT UNIQUE,
  avatar_url TEXT,
  role app_role NOT NULL DEFAULT 'citizen',
  department_id UUID REFERENCES public.departments(id),
  employee_id TEXT,
  status TEXT DEFAULT 'active',
  language_pref TEXT DEFAULT 'en',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Profiles -> auth.users Relationship (Idempotent Foreign Key DO Block)
DO $$
DECLARE
  orphan_count INT := 0;
  fk_exists BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'profiles_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'profiles'
  ) INTO fk_exists;

  IF NOT fk_exists THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'auth' AND table_name = 'users'
    ) THEN
      SELECT COUNT(*) INTO orphan_count
      FROM public.profiles p
      WHERE NOT EXISTS (
        SELECT 1 FROM auth.users u WHERE u.id = p.id
      );

      IF orphan_count = 0 THEN
        ALTER TABLE public.profiles
          ADD CONSTRAINT profiles_id_fkey
          FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
      ELSE
        -- TODO: Orphan profiles exist. Reconciliation required with auth.users before applying profiles_id_fkey constraint.
        RAISE NOTICE 'Orphan profiles found (count: %): reconciliation required before adding profiles_id_fkey', orphan_count;
      END IF;
    END IF;
  END IF;
END $$;

-- 4. User Roles Table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'citizen',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, role)
);

-- 5. Department Heads Table
CREATE TABLE IF NOT EXISTS public.department_heads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  employee_id TEXT,
  designation TEXT DEFAULT 'Department Head',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Complaints Table
CREATE TABLE IF NOT EXISTS public.complaints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  complaint_number TEXT UNIQUE NOT NULL,
  citizen_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  photo_before_url TEXT NOT NULL,
  photo_after_url TEXT,
  photo_front_url TEXT,
  photo_left_url TEXT,
  photo_right_url TEXT,
  photo_closeup_url TEXT,
  angle_photos JSONB,
  additional_photos JSONB,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority priority_level_type DEFAULT 'Medium',
  status complaint_status_type DEFAULT 'Submitted',
  department_id UUID REFERENCES public.departments(id),
  latitude NUMERIC(10, 7) NOT NULL DEFAULT 0,
  longitude NUMERIC(10, 7) NOT NULL DEFAULT 0,
  location_source TEXT NOT NULL DEFAULT 'manual_pin',
  location_address TEXT,
  duplicate_of_id UUID REFERENCES public.complaints(id) ON DELETE SET NULL,
  support_count INT DEFAULT 0,
  ai_category TEXT,
  ai_specific_issue TEXT,
  ai_confidence NUMERIC(5,4),
  ai_severity TEXT,
  ai_urgency TEXT,
  ai_evidence TEXT,
  ai_model TEXT,
  ai_analyzed_at TIMESTAMP WITH TIME ZONE,
  assigned_staff_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_staff_name TEXT,
  assigned_staff_email TEXT,
  assigned_staff_employee_id TEXT,
  assigned_at TIMESTAMP WITH TIME ZONE,
  sla_deadline TIMESTAMP WITH TIME ZONE,
  work_performed TEXT,
  materials_used TEXT,
  additional_notes TEXT,
  resolution_notes TEXT,
  resolution_submitted_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_by_name TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Idempotent Column Additions for Complaints Table
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS photo_front_url TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS photo_left_url TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS photo_right_url TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS photo_closeup_url TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS angle_photos JSONB;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS additional_photos JSONB;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ai_category TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ai_specific_issue TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(5,4);
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ai_severity TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ai_urgency TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ai_evidence TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ai_model TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS assigned_staff_id UUID;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS assigned_staff_name TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS assigned_staff_email TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS assigned_staff_employee_id TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS work_performed TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS materials_used TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS additional_notes TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS resolution_submitted_at TIMESTAMPTZ;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS verified_by UUID;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS verified_by_name TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'complaints_assigned_staff_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'complaints'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_assigned_staff_id_fkey
      FOREIGN KEY (assigned_staff_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'complaints_verified_by_fkey'
      AND table_schema = 'public'
      AND table_name = 'complaints'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_verified_by_fkey
      FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 7. Task Assignments Table (Canonical)
CREATE TABLE IF NOT EXISTS public.task_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id),
  sla_deadline TIMESTAMP WITH TIME ZONE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  accepted_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'Assigned',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Idempotent Column Additions for Task Assignments Table
ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());
ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Compatibility View for Legacy "assignments" References
CREATE OR REPLACE VIEW public.assignments
WITH (security_invoker = true)
AS SELECT * FROM public.task_assignments;

-- 8. Complaint Feedback Table
CREATE TABLE IF NOT EXISTS public.complaint_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  is_resolved BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Unique index to prevent duplicate feedback per complaint
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaint_feedback_complaint_id ON public.complaint_feedback(complaint_id);

-- 9. Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'citizen',
  complaint_id UUID REFERENCES public.complaints(id) ON DELETE CASCADE,
  complaint_number TEXT,
  channel TEXT NOT NULL DEFAULT 'in_app',
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL DEFAULT 'Notification',
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'in_app';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());
ALTER TABLE public.notifications ALTER COLUMN type SET DEFAULT 'general';
ALTER TABLE public.notifications ALTER COLUMN title SET DEFAULT 'Notification';

-- 10. Complaint Status History Table
CREATE TABLE IF NOT EXISTS public.complaint_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  remark TEXT,
  department TEXT,
  updated_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 11. Department Leadership Audit Logs Table
CREATE TABLE IF NOT EXISTS public.department_leadership_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action TEXT NOT NULL,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  old_head_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  new_head_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  performed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 12. Safe Role & Department Helper Functions (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_department()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT department_id FROM public.profiles WHERE id = auth.uid() LIMIT 1),
    (SELECT department_id FROM public.department_heads WHERE user_id = auth.uid() LIMIT 1)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_department() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_department() TO authenticated;

-- 13. Auto-Create Profile Trigger for New Auth Users (Defaults to 'citizen')
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Citizen User'),
    NEW.email,
    'citizen'::app_role
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'citizen'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- 14. Performance & Query Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_complaints_citizen_id ON public.complaints(citizen_id);
CREATE INDEX IF NOT EXISTS idx_complaints_department_id ON public.complaints(department_id);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned_staff_id ON public.complaints(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON public.complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON public.complaints(created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_category_status ON public.complaints(category, status);

CREATE INDEX IF NOT EXISTS idx_task_assignments_complaint_id ON public.task_assignments(complaint_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_staff_id ON public.task_assignments(staff_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_staff_id_status ON public.task_assignments(staff_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_sent_at ON public.notifications(user_id, sent_at);

-- 15. Enable Row Level Security (RLS)
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_leadership_audit_logs ENABLE ROW LEVEL SECURITY;

-- 16. Drop Dangerous / Legacy RLS Policies
DROP POLICY IF EXISTS "Public select departments" ON public.departments;
DROP POLICY IF EXISTS "Public select profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public select user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Public select department_heads" ON public.department_heads;
DROP POLICY IF EXISTS "Public select complaints" ON public.complaints;
DROP POLICY IF EXISTS "Public select task_assignments" ON public.task_assignments;
DROP POLICY IF EXISTS "Public select complaint_feedback" ON public.complaint_feedback;
DROP POLICY IF EXISTS "Public select notifications" ON public.notifications;
DROP POLICY IF EXISTS "Public select status_history" ON public.complaint_status_history;

DROP POLICY IF EXISTS "Profiles select policy" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;
DROP POLICY IF EXISTS "User roles select policy" ON public.user_roles;
DROP POLICY IF EXISTS "User roles admin manage policy" ON public.user_roles;
DROP POLICY IF EXISTS "Department heads select policy" ON public.department_heads;
DROP POLICY IF EXISTS "Complaints select policy" ON public.complaints;
DROP POLICY IF EXISTS "Complaints insert policy" ON public.complaints;
DROP POLICY IF EXISTS "Complaints update policy" ON public.complaints;
DROP POLICY IF EXISTS "Task assignments select policy" ON public.task_assignments;
DROP POLICY IF EXISTS "Task assignments update policy" ON public.task_assignments;
DROP POLICY IF EXISTS "Task assignments admin manage" ON public.task_assignments;
DROP POLICY IF EXISTS "Complaint feedback select policy" ON public.complaint_feedback;
DROP POLICY IF EXISTS "Complaint feedback insert policy" ON public.complaint_feedback;
DROP POLICY IF EXISTS "Notifications select policy" ON public.notifications;
DROP POLICY IF EXISTS "Notifications update policy" ON public.notifications;
DROP POLICY IF EXISTS "Complaint status history select policy" ON public.complaint_status_history;

-- 17. Recreate Hardened RLS Policies

-- Departments: Publicly readable for category / routing selection
CREATE POLICY "Public select departments" ON public.departments
  FOR SELECT USING (true);

-- Profiles: Own profile, city_admin all, department_head for own department; update own only
CREATE POLICY "Profiles select policy" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR current_user_role() = 'city_admin'
    OR (current_user_role() = 'department_head' AND department_id = current_user_department())
  );

CREATE POLICY "Profiles update policy" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- User Roles: Own roles or city_admin; manage restricted to city_admin
CREATE POLICY "User roles select policy" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR current_user_role() = 'city_admin'
  );

CREATE POLICY "User roles admin manage policy" ON public.user_roles
  FOR ALL TO authenticated
  USING (current_user_role() = 'city_admin')
  WITH CHECK (current_user_role() = 'city_admin');

-- Department Heads: Own record, or admin / department leadership
CREATE POLICY "Department heads select policy" ON public.department_heads
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR current_user_role() IN ('city_admin', 'department_head')
  );

-- Complaints:
-- SELECT: Citizen own, assigned staff, city_admin, department head for own department
CREATE POLICY "Complaints select policy" ON public.complaints
  FOR SELECT TO authenticated
  USING (
    citizen_id = auth.uid()
    OR assigned_staff_id = auth.uid()
    OR current_user_role() IN ('city_admin', 'admin')
    OR (current_user_role() = 'department_head' AND department_id = current_user_department())
  );

-- INSERT: Authenticated citizen can only insert complaint with citizen_id = auth.uid()
CREATE POLICY "Complaints insert policy" ON public.complaints
  FOR INSERT TO authenticated
  WITH CHECK (
    citizen_id = auth.uid()
  );

-- UPDATE: Only city_admin, department head for own dept, assigned staff for assigned complaint
CREATE POLICY "Complaints update policy" ON public.complaints
  FOR UPDATE TO authenticated
  USING (
    current_user_role() IN ('city_admin', 'admin')
    OR (current_user_role() = 'department_head' AND department_id = current_user_department())
    OR (current_user_role() = 'service_staff' AND assigned_staff_id = auth.uid())
  )
  WITH CHECK (
    current_user_role() IN ('city_admin', 'admin')
    OR (current_user_role() = 'department_head' AND department_id = current_user_department())
    OR (current_user_role() = 'service_staff' AND assigned_staff_id = auth.uid())
  );

-- Task Assignments:
-- SELECT: Staff own assignments, city_admin, department_head for department complaints
CREATE POLICY "Task assignments select policy" ON public.task_assignments
  FOR SELECT TO authenticated
  USING (
    staff_id = auth.uid()
    OR current_user_role() = 'city_admin'
    OR (
      current_user_role() = 'department_head'
      AND EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = task_assignments.complaint_id
          AND c.department_id = current_user_department()
      )
    )
  );

-- UPDATE: Staff own, city_admin, or department_head for department complaints
CREATE POLICY "Task assignments update policy" ON public.task_assignments
  FOR UPDATE TO authenticated
  USING (
    staff_id = auth.uid()
    OR current_user_role() = 'city_admin'
    OR (
      current_user_role() = 'department_head'
      AND EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = task_assignments.complaint_id
          AND c.department_id = current_user_department()
      )
    )
  )
  WITH CHECK (
    staff_id = auth.uid()
    OR current_user_role() = 'city_admin'
    OR (
      current_user_role() = 'department_head'
      AND EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = task_assignments.complaint_id
          AND c.department_id = current_user_department()
      )
    )
  );

CREATE POLICY "Task assignments admin manage" ON public.task_assignments
  FOR ALL TO authenticated
  USING (current_user_role() = 'city_admin')
  WITH CHECK (current_user_role() = 'city_admin');

-- Complaint Feedback:
-- Citizen may read/insert only if linked complaint belongs to auth.uid() and is resolved/completed
CREATE POLICY "Complaint feedback select policy" ON public.complaint_feedback
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = complaint_feedback.complaint_id
        AND (c.citizen_id = auth.uid() OR current_user_role() = 'city_admin')
    )
  );

CREATE POLICY "Complaint feedback insert policy" ON public.complaint_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = complaint_feedback.complaint_id
        AND c.citizen_id = auth.uid()
        AND c.status IN ('Resolved', 'Resolution Submitted')
    )
  );

-- Notifications:
-- User can read and update own notifications; city_admin can read all
CREATE POLICY "Notifications select policy" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR current_user_role() = 'city_admin'
  );

CREATE POLICY "Notifications update policy" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Complaint Status History:
-- Visible only to complaint owner, assigned staff, department head, or city_admin
CREATE POLICY "Complaint status history select policy" ON public.complaint_status_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = complaint_status_history.complaint_id
        AND (
          c.citizen_id = auth.uid()
          OR c.assigned_staff_id = auth.uid()
          OR (current_user_role() = 'department_head' AND c.department_id = current_user_department())
          OR current_user_role() = 'city_admin'
        )
    )
  );

-- 18. Idempotent Realtime Publications
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'complaints'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'department_heads'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.department_heads;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 19. Additional Operational, Audit, Blockchain, and Compatibility Definitions
-- ============================================================================

-- Feedback Compatibility View
CREATE OR REPLACE VIEW public.feedback AS
SELECT 
    id,
    complaint_id,
    rating,
    comment,
    created_at
FROM public.complaint_feedback;

-- Announcements Table
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

DROP POLICY IF EXISTS "Announcements read policy" ON public.announcements;
CREATE POLICY "Announcements read policy" ON public.announcements
    FOR SELECT TO authenticated, anon
    USING (is_published = 1);

-- Announcement Reads Table
CREATE TABLE IF NOT EXISTS public.announcement_reads (
    id SERIAL PRIMARY KEY,
    announcement_id INT NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    read_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    UNIQUE(announcement_id, user_id)
);

ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

-- Recurring Issue Links Table
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

DROP POLICY IF EXISTS "Recurring issue links view policy" ON public.recurring_issue_links;
CREATE POLICY "Recurring issue links view policy" ON public.recurring_issue_links
    FOR SELECT TO authenticated
    USING (true);

-- Super Admin Audit Logs Table
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

-- Complaint Evidence Versions Table
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

-- Blockchain Blocks Table
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

-- Blockchain Transactions Table
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

DROP POLICY IF EXISTS "Blockchain blocks public verify" ON public.blockchain_blocks;
CREATE POLICY "Blockchain blocks public verify" ON public.blockchain_blocks
    FOR SELECT TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "Blockchain transactions public verify" ON public.blockchain_transactions;
CREATE POLICY "Blockchain transactions public verify" ON public.blockchain_transactions
    FOR SELECT TO authenticated, anon
    USING (true);
