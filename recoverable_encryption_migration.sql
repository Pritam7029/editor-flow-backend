-- Recoverable Passphrase-Based E2EE Migration

-- 1. Create user_encryption_identities table
CREATE TABLE IF NOT EXISTS public.user_encryption_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    private_key_iv TEXT NOT NULL,
    kdf_algorithm TEXT NOT NULL DEFAULT 'PBKDF2',
    kdf_salt TEXT NOT NULL,
    kdf_iterations INTEGER NOT NULL DEFAULT 600000,
    key_algorithm TEXT NOT NULL DEFAULT 'X25519',
    recovery_question_key TEXT NOT NULL,
    recovery_question_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_user_encryption_identity UNIQUE (user_id)
);

-- Enable RLS for user_encryption_identities
ALTER TABLE public.user_encryption_identities ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_encryption_identities
CREATE POLICY select_user_encryption_identities ON public.user_encryption_identities 
    FOR SELECT USING (true);

CREATE POLICY manage_user_encryption_identities ON public.user_encryption_identities 
    FOR ALL USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_user_encryption_identities_user ON public.user_encryption_identities(user_id);

-- Setup updated_at trigger for user_encryption_identities
CREATE OR REPLACE TRIGGER set_user_encryption_identities_updated_at 
    BEFORE UPDATE ON public.user_encryption_identities 
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Drop and Recreate workspace_key_grants table (shifting from device-key to user-level)
DROP TABLE IF EXISTS public.workspace_key_grants CASCADE;

CREATE TABLE public.workspace_key_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    workspace_key_id UUID NOT NULL REFERENCES public.workspace_encryption_keys(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    encrypted_workspace_key TEXT NOT NULL,
    grant_iv TEXT,
    grant_algorithm TEXT NOT NULL,
    granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT unique_workspace_key_recipient UNIQUE (workspace_key_id, recipient_user_id)
);

-- Enable RLS for workspace_key_grants
ALTER TABLE public.workspace_key_grants ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workspace_key_grants
CREATE POLICY select_workspace_key_grants ON public.workspace_key_grants 
    FOR SELECT USING (
        recipient_user_id = auth.uid() OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
        )
    );

CREATE POLICY manage_workspace_key_grants ON public.workspace_key_grants 
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_id = workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'
        )
    );

CREATE INDEX IF NOT EXISTS idx_workspace_key_grants_recipient ON public.workspace_key_grants(recipient_user_id);

-- 3. Modify chat_messages columns for E2EE if they do not exist
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS encrypted_body TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS body_iv TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS encryption_algorithm TEXT DEFAULT 'AES-GCM';
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS workspace_key_id UUID REFERENCES public.workspace_encryption_keys(id) ON DELETE SET NULL;
