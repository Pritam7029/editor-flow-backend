-- E2EE Chat Schema Migration

-- 1. Create user_device_keys table
CREATE TABLE IF NOT EXISTS public.user_device_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_name TEXT,
    public_key TEXT NOT NULL,
    algorithm TEXT NOT NULL DEFAULT 'RSA-OAEP',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

-- 2. Create workspace_encryption_keys table
CREATE TABLE IF NOT EXISTS public.workspace_encryption_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    key_version INTEGER NOT NULL,
    algorithm TEXT NOT NULL DEFAULT 'AES-GCM',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'rotated')),
    created_by UUID NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_workspace_key_version UNIQUE (workspace_id, key_version)
);

-- 3. Create workspace_key_grants table
CREATE TABLE IF NOT EXISTS public.workspace_key_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    workspace_key_id UUID NOT NULL REFERENCES public.workspace_encryption_keys(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    device_key_id UUID NOT NULL REFERENCES public.user_device_keys(id) ON DELETE CASCADE,
    encrypted_workspace_key TEXT NOT NULL,
    grant_algorithm TEXT NOT NULL,
    granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT unique_workspace_key_device UNIQUE (workspace_key_id, device_key_id)
);

-- 4. Create chat_threads table
CREATE TABLE IF NOT EXISTS public.chat_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'workspace' CHECK (type IN ('workspace', 'group', 'dm', 'task', 'file')),
    encrypted_name TEXT,
    name_iv TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Create chat_thread_members table
CREATE TABLE IF NOT EXISTS public.chat_thread_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_message_id UUID,
    last_read_at TIMESTAMPTZ,
    CONSTRAINT unique_thread_user UNIQUE (thread_id, user_id)
);

-- 6. Modify / Extend existing chat_messages table to support E2EE
ALTER TABLE public.chat_messages ALTER COLUMN text DROP NOT NULL;

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES public.chat_threads(id) ON DELETE CASCADE;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS sender_device_key_id UUID REFERENCES public.user_device_keys(id) ON DELETE SET NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS workspace_key_id UUID REFERENCES public.workspace_encryption_keys(id) ON DELETE SET NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS encrypted_body TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS body_iv TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS encryption_algorithm TEXT DEFAULT 'AES-GCM';
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS client_message_id TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 7. Create message_receipts table
CREATE TABLE IF NOT EXISTS public.message_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    CONSTRAINT unique_message_user_receipt UNIQUE (message_id, user_id)
);

-- 8. Create message_attachments table
CREATE TABLE IF NOT EXISTS public.message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    storage_provider TEXT NOT NULL DEFAULT 's3',
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    encrypted_file_key TEXT NOT NULL,
    file_key_iv TEXT NOT NULL,
    encrypted_file_name TEXT,
    file_name_iv TEXT,
    mime_type TEXT,
    size_bytes BIGINT,
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Create Indexes for query optimization
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON public.chat_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace_created ON public.chat_messages(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_thread_members_user ON public.chat_thread_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_key_grants_user_device ON public.workspace_key_grants(user_id, device_key_id);
CREATE INDEX IF NOT EXISTS idx_message_receipts_user_read ON public.message_receipts(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_user_device_keys_user_status ON public.user_device_keys(user_id, status);

-- 10. Enable Row Level Security (RLS) on all new tables
ALTER TABLE public.user_device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_encryption_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_key_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_thread_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- 11. Define RLS Policies
-- Use the database member check helpers if they exist, or check auth.uid()
CREATE POLICY select_device_keys ON public.user_device_keys FOR SELECT USING (true);
CREATE POLICY manage_own_device_keys ON public.user_device_keys FOR ALL USING (user_id = auth.uid());

CREATE POLICY select_workspace_encryption_keys ON public.workspace_encryption_keys FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);
CREATE POLICY manage_workspace_encryption_keys ON public.workspace_encryption_keys FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);

CREATE POLICY select_workspace_key_grants ON public.workspace_key_grants FOR SELECT USING (
    user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);
CREATE POLICY manage_workspace_key_grants ON public.workspace_key_grants FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);

CREATE POLICY select_chat_threads ON public.chat_threads FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);
CREATE POLICY manage_chat_threads ON public.chat_threads FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);

CREATE POLICY select_chat_thread_members ON public.chat_thread_members FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.chat_threads ct
        JOIN public.workspace_members wm ON wm.workspace_id = ct.workspace_id
        WHERE ct.id = thread_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);
CREATE POLICY manage_chat_thread_members ON public.chat_thread_members FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.chat_threads ct
        JOIN public.workspace_members wm ON wm.workspace_id = ct.workspace_id
        WHERE ct.id = thread_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);

CREATE POLICY select_message_receipts ON public.message_receipts FOR SELECT USING (true);
CREATE POLICY manage_message_receipts ON public.message_receipts FOR ALL USING (user_id = auth.uid());

CREATE POLICY select_message_attachments ON public.message_attachments FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
    )
);
CREATE POLICY manage_message_attachments ON public.message_attachments FOR ALL USING (
    uploaded_by = auth.uid()
);

-- 12. Setup Triggers for Automatic updated_at Timestamps
CREATE OR REPLACE TRIGGER set_chat_threads_updated_at BEFORE UPDATE ON public.chat_threads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER set_message_attachments_updated_at BEFORE UPDATE ON public.message_attachments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
