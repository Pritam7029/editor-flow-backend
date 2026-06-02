-- Phase 3 Schema Migration: Workspace Invite System

-- 1. Create workspace_invites table
CREATE TABLE IF NOT EXISTS public.workspace_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add composite index on workspace_id + email + status
CREATE INDEX IF NOT EXISTS idx_workspace_invites_lookup 
ON public.workspace_invites (workspace_id, email, status);

-- 3. Enable Row Level Security (RLS) on workspace_invites
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- 4. Set up Row Level Security Policies
-- Owners and Admins of the workspace can read, insert, update, or delete invites
CREATE POLICY select_invites ON public.workspace_invites
    FOR SELECT
    USING (
        is_workspace_admin(workspace_id) OR is_workspace_owner(workspace_id)
    );

CREATE POLICY insert_invites ON public.workspace_invites
    FOR INSERT
    WITH CHECK (
        is_workspace_admin(workspace_id) OR is_workspace_owner(workspace_id)
    );

CREATE POLICY update_invites ON public.workspace_invites
    FOR UPDATE
    USING (
        is_workspace_admin(workspace_id) OR is_workspace_owner(workspace_id)
    );

CREATE POLICY delete_invites ON public.workspace_invites
    FOR DELETE
    USING (
        is_workspace_admin(workspace_id) OR is_workspace_owner(workspace_id)
    );
