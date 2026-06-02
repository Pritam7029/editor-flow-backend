-- Phase 6 Schema Migration: Chat & Messaging System

-- 1. Create chat_teams table
CREATE TABLE IF NOT EXISTS public.chat_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on workspace_id for fast retrieval of teams per workspace
CREATE INDEX IF NOT EXISTS idx_chat_teams_workspace ON public.chat_teams (workspace_id);

-- 2. Create chat_team_members table
CREATE TABLE IF NOT EXISTS public.chat_team_members (
    team_id UUID NOT NULL REFERENCES public.chat_teams(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, member_id)
);

-- Index on member_id for listing teams a member is in
CREATE INDEX IF NOT EXISTS idx_chat_team_members_member ON public.chat_team_members (member_id);

-- 3. Create chat_messages table
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('general', 'links', 'feedback')),
    conv_type TEXT NOT NULL CHECK (conv_type IN ('global', 'dm', 'team')),
    recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- For DM messages
    team_id UUID REFERENCES public.chat_teams(id) ON DELETE CASCADE,       -- For team messages
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast query lookup
CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace ON public.chat_messages (workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_team ON public.chat_messages (team_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_recipient ON public.chat_messages (sender_id, recipient_id);

-- 4. Enable Row Level Security (RLS) on all tables
ALTER TABLE public.chat_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 5. Row Level Security Policies
-- Chat Teams Policies
CREATE POLICY select_chat_teams ON public.chat_teams
    FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY insert_chat_teams ON public.chat_teams
    FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY update_chat_teams ON public.chat_teams
    FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY delete_chat_teams ON public.chat_teams
    FOR DELETE USING (is_workspace_member(workspace_id));

-- Chat Team Members Policies
CREATE POLICY select_chat_team_members ON public.chat_team_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.chat_teams t 
            WHERE t.id = team_id AND is_workspace_member(t.workspace_id)
        )
    );

CREATE POLICY insert_chat_team_members ON public.chat_team_members
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.chat_teams t 
            WHERE t.id = team_id AND is_workspace_member(t.workspace_id)
        )
    );

CREATE POLICY delete_chat_team_members ON public.chat_team_members
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.chat_teams t 
            WHERE t.id = team_id AND is_workspace_member(t.workspace_id)
        )
    );

-- Chat Messages Policies
CREATE POLICY select_chat_messages ON public.chat_messages
    FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY insert_chat_messages ON public.chat_messages
    FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY delete_chat_messages ON public.chat_messages
    FOR DELETE USING (is_workspace_member(workspace_id));

-- 6. Setup Trigger for Automatic updated_at on chat_teams
CREATE OR REPLACE TRIGGER set_chat_teams_updated_at
    BEFORE UPDATE ON public.chat_teams
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
