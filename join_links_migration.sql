-- Phase E Schema Migration: Workspace Join Links & Requests System

-- 1. Create workspace_join_links table
CREATE TABLE IF NOT EXISTS public.workspace_join_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    default_requested_role TEXT NOT NULL DEFAULT 'editor',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    expires_at TIMESTAMPTZ,
    max_uses INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create workspace_join_requests table
CREATE TABLE IF NOT EXISTS public.workspace_join_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    join_link_id UUID REFERENCES public.workspace_join_links(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    requested_role TEXT NOT NULL DEFAULT 'editor',
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_pending_requester UNIQUE (workspace_id, requester_id, status)
);

-- 3. Enable Row Level Security (RLS) on both tables
ALTER TABLE public.workspace_join_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_join_requests ENABLE ROW LEVEL SECURITY;

-- 4. Policies for join links
CREATE POLICY select_join_links ON public.workspace_join_links FOR SELECT USING (
    is_workspace_member(workspace_id) OR auth.uid() IS NOT NULL
);
CREATE POLICY manage_join_links ON public.workspace_join_links FOR ALL USING (
    is_workspace_admin(workspace_id) OR is_workspace_owner(workspace_id)
);

-- 5. Policies for join requests
CREATE POLICY select_join_requests ON public.workspace_join_requests FOR SELECT USING (
    is_workspace_member(workspace_id) OR requester_id = auth.uid()
);
CREATE POLICY insert_join_requests ON public.workspace_join_requests FOR INSERT WITH CHECK (
    requester_id = auth.uid()
);
CREATE POLICY update_join_requests ON public.workspace_join_requests FOR UPDATE USING (
    is_workspace_admin(workspace_id) OR is_workspace_owner(workspace_id) OR requester_id = auth.uid()
);

-- 6. Setup Triggers for Automatic updated_at Timestamps
CREATE OR REPLACE TRIGGER set_workspace_join_links_updated_at BEFORE UPDATE ON public.workspace_join_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER set_workspace_join_requests_updated_at BEFORE UPDATE ON public.workspace_join_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
