-- Phase 5 Schema Migration: File & Media Review Backend & Comments

-- 1. Create workspace_files table
CREATE TABLE IF NOT EXISTS public.workspace_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size BIGINT,
    data_url TEXT, -- stores compressed base64 content for images <= 2 MB
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    visible_to UUID[] DEFAULT NULL, -- optional array of collaborator IDs (workspace_members id/profiles id) allowed to see this file
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on workspace_id for rapid retrieval of workspace files
CREATE INDEX IF NOT EXISTS idx_workspace_files_workspace ON public.workspace_files (workspace_id);

-- 2. Create file_comments table
CREATE TABLE IF NOT EXISTS public.file_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES public.workspace_files(id) ON DELETE CASCADE,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    timestamp DOUBLE PRECISION DEFAULT NULL, -- stores video playback marker seek offset in seconds
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on file_id for rapid loading of comments per file
CREATE INDEX IF NOT EXISTS idx_file_comments_file ON public.file_comments (file_id);

-- 3. Enable Row Level Security (RLS) on both tables
ALTER TABLE public.workspace_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_comments ENABLE ROW LEVEL SECURITY;

-- 4. Row Level Security Policies
-- Workspace Files Policies
CREATE POLICY select_files ON public.workspace_files
    FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY insert_files ON public.workspace_files
    FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY update_files ON public.workspace_files
    FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY delete_files ON public.workspace_files
    FOR DELETE USING (is_workspace_member(workspace_id));

-- File Comments Policies
CREATE POLICY select_file_comments ON public.file_comments
    FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY insert_file_comments ON public.file_comments
    FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY update_file_comments ON public.file_comments
    FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY delete_file_comments ON public.file_comments
    FOR DELETE USING (is_workspace_member(workspace_id));

-- 5. Setup Triggers for Automatic updated_at Timestamps
CREATE OR REPLACE TRIGGER set_workspace_files_updated_at
    BEFORE UPDATE ON public.workspace_files
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_file_comments_updated_at
    BEFORE UPDATE ON public.file_comments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
