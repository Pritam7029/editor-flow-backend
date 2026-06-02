-- Phase 4 Schema Migration: Kanban Task Board & Comment System

-- 1. Create task_columns table
CREATE TABLE IF NOT EXISTS public.task_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '📌',
    color TEXT NOT NULL DEFAULT '#8b5cf6',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_workspace_column_key UNIQUE (workspace_id, key)
);

-- Index on workspace_id for fast retrieval
CREATE INDEX IF NOT EXISTS idx_task_columns_workspace ON public.task_columns (workspace_id);

-- 2. Create tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    column_id UUID REFERENCES public.task_columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'other',
    priority TEXT NOT NULL DEFAULT 'medium',
    assignee_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    deadline TIMESTAMPTZ,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for rapid joins & queries
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON public.tasks (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_column ON public.tasks (column_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks (assignee_id);

-- 3. Create task_comments table
CREATE TABLE IF NOT EXISTS public.task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments (task_id);

-- 4. Enable Row Level Security (RLS) on all tables
ALTER TABLE public.task_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

-- 5. Row Level Security Policies
-- Task Columns Policies
CREATE POLICY select_columns ON public.task_columns
    FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY insert_columns ON public.task_columns
    FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY update_columns ON public.task_columns
    FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY delete_columns ON public.task_columns
    FOR DELETE USING (is_workspace_member(workspace_id));

-- Tasks Policies
CREATE POLICY select_tasks ON public.tasks
    FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY insert_tasks ON public.tasks
    FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY update_tasks ON public.tasks
    FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY delete_tasks ON public.tasks
    FOR DELETE USING (is_workspace_member(workspace_id));

-- Task Comments Policies
CREATE POLICY select_comments ON public.task_comments
    FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY insert_comments ON public.task_comments
    FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY update_comments ON public.task_comments
    FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY delete_comments ON public.task_comments
    FOR DELETE USING (is_workspace_member(workspace_id));

-- 6. Setup Triggers for Automatic updated_at
CREATE OR REPLACE TRIGGER set_task_columns_updated_at
    BEFORE UPDATE ON public.task_columns
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_task_comments_updated_at
    BEFORE UPDATE ON public.task_comments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
