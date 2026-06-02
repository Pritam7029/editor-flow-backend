-- Phase 8 Schema Migration: Persistent Workspace Notifications & Activity Log

-- 1. Create workspace_notifications table
CREATE TABLE IF NOT EXISTS public.workspace_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL means visible to everyone in workspace
    icon TEXT NOT NULL DEFAULT '🔔',
    icon_class TEXT NOT NULL DEFAULT 'mention-notif',
    title TEXT NOT NULL,
    sub TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexing for high-performance reads
CREATE INDEX IF NOT EXISTS idx_workspace_notifications_workspace ON public.workspace_notifications (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_notifications_recipient ON public.workspace_notifications (recipient_id);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.workspace_notifications ENABLE ROW LEVEL SECURITY;

-- 3. Row Level Security Policies
-- Users can only select notifications belonging to workspaces they are a member of, and where recipient is either null or their own user ID
DROP POLICY IF EXISTS select_workspace_notifications ON public.workspace_notifications;
CREATE POLICY select_workspace_notifications ON public.workspace_notifications
    FOR SELECT USING (
        is_workspace_member(workspace_id) AND (recipient_id IS NULL OR recipient_id = auth.uid())
    );

-- Workspace members can insert notifications
DROP POLICY IF EXISTS insert_workspace_notifications ON public.workspace_notifications;
CREATE POLICY insert_workspace_notifications ON public.workspace_notifications
    FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

-- Workspace members can update notifications (e.g. read status)
DROP POLICY IF EXISTS update_workspace_notifications ON public.workspace_notifications;
CREATE POLICY update_workspace_notifications ON public.workspace_notifications
    FOR UPDATE USING (is_workspace_member(workspace_id));

-- Workspace members can delete/clear notifications
DROP POLICY IF EXISTS delete_workspace_notifications ON public.workspace_notifications;
CREATE POLICY delete_workspace_notifications ON public.workspace_notifications
    FOR DELETE USING (is_workspace_member(workspace_id));
