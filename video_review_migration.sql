-- Phase F Schema Migration: Video Review Tables (Files, Versions & Revisions)

-- 1. Create files table
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    file_type TEXT NOT NULL DEFAULT 'video',
    mime_type TEXT,
    size_bytes BIGINT,
    storage_provider TEXT NOT NULL DEFAULT 'supabase',
    storage_bucket TEXT DEFAULT 'workspace-files',
    storage_path TEXT,
    external_video_id TEXT,
    playback_url TEXT,
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'ready', 'failed', 'deleted')),
    visible_to UUID[] DEFAULT NULL, -- added for collaboration parity
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create file_versions table
CREATE TABLE IF NOT EXISTS public.file_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    storage_provider TEXT NOT NULL DEFAULT 'supabase',
    storage_bucket TEXT DEFAULT 'workspace-files',
    storage_path TEXT,
    external_video_id TEXT,
    playback_url TEXT,
    duration_seconds NUMERIC,
    size_bytes BIGINT,
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'ready', 'failed', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create file_revisions table
CREATE TABLE IF NOT EXISTS public.file_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    file_version_id UUID NOT NULL REFERENCES public.file_versions(id) ON DELETE CASCADE,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    timestamp_seconds NUMERIC NOT NULL CHECK (timestamp_seconds >= 0),
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Create database indexes for optimal querying
CREATE INDEX IF NOT EXISTS idx_files_workspace_id ON public.files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON public.file_versions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_revisions_file_id ON public.file_revisions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_revisions_file_version_id ON public.file_revisions(file_version_id);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_revisions ENABLE ROW LEVEL SECURITY;

-- 6. Setup RLS Policies for Files (accessible by workspace members)
CREATE POLICY select_files ON public.files FOR SELECT USING (
    is_workspace_member(workspace_id)
);
CREATE POLICY insert_files ON public.files FOR INSERT WITH CHECK (
    is_workspace_member(workspace_id)
);
CREATE POLICY update_files ON public.files FOR UPDATE USING (
    is_workspace_member(workspace_id)
);
CREATE POLICY delete_files ON public.files FOR DELETE USING (
    is_workspace_member(workspace_id)
);

-- 7. Setup RLS Policies for File Versions
CREATE POLICY select_file_versions ON public.file_versions FOR SELECT USING (
    is_workspace_member(workspace_id)
);
CREATE POLICY insert_file_versions ON public.file_versions FOR INSERT WITH CHECK (
    is_workspace_member(workspace_id)
);
CREATE POLICY update_file_versions ON public.file_versions FOR UPDATE USING (
    is_workspace_member(workspace_id)
);
CREATE POLICY delete_file_versions ON public.file_versions FOR DELETE USING (
    is_workspace_member(workspace_id)
);

-- 8. Setup RLS Policies for File Revisions
CREATE POLICY select_file_revisions ON public.file_revisions FOR SELECT USING (
    is_workspace_member(workspace_id)
);
CREATE POLICY insert_file_revisions ON public.file_revisions FOR INSERT WITH CHECK (
    is_workspace_member(workspace_id)
);
CREATE POLICY update_file_revisions ON public.file_revisions FOR UPDATE USING (
    is_workspace_member(workspace_id)
);
CREATE POLICY delete_file_revisions ON public.file_revisions FOR DELETE USING (
    is_workspace_member(workspace_id)
);

-- 9. Setup updated_at Triggers (using standard set_updated_at() helper function)
CREATE OR REPLACE TRIGGER set_files_updated_at BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER set_file_versions_updated_at BEFORE UPDATE ON public.file_versions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER set_file_revisions_updated_at BEFORE UPDATE ON public.file_revisions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
