-- Phase C Schema Migration: Billing & Plans Foundation

-- 1. Create plans table
CREATE TABLE IF NOT EXISTS public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE, -- 'free', 'growth', 'custom'
    name TEXT NOT NULL,
    description TEXT,
    price_amount INTEGER NOT NULL, -- e.g., 0 or 2500 (representing $25.00)
    currency TEXT NOT NULL DEFAULT 'USD',
    billing_interval TEXT NOT NULL DEFAULT 'month',
    max_workspaces INTEGER NOT NULL,
    max_members INTEGER NOT NULL,
    max_storage_bytes BIGINT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed plans
INSERT INTO public.plans (key, name, description, price_amount, currency, billing_interval, max_workspaces, max_members, max_storage_bytes, is_public)
VALUES 
('free', 'Free', 'Great for small teams or getting started.', 0, 'USD', 'month', 1, 4, 2147483648, true), -- 2 GB
('growth', 'Growth', 'Perfect for growing production teams.', 2500, 'USD', 'month', 5, 20, 1099511627776, true), -- 1 TB
('custom', 'Custom', 'Customized limits and terms for enterprise needs.', 0, 'USD', 'month', 99999, 99999, 109951162777600, true) -- Custom
ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_amount = EXCLUDED.price_amount,
    max_workspaces = EXCLUDED.max_workspaces,
    max_members = EXCLUDED.max_members,
    max_storage_bytes = EXCLUDED.max_storage_bytes;

-- 2. Create billing_accounts table
CREATE TABLE IF NOT EXISTS public.billing_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    plan_key TEXT NOT NULL DEFAULT 'free' REFERENCES public.plans(key),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'past_due', 'custom_pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_owner_billing UNIQUE (owner_id)
);

-- 3. Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_account_id UUID NOT NULL REFERENCES public.billing_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('stripe', 'razorpay', 'manual')),
    provider_customer_id TEXT,
    provider_subscription_id TEXT UNIQUE,
    provider_price_id TEXT,
    status TEXT NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Update workspaces to add billing_account_id
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS billing_account_id UUID REFERENCES public.billing_accounts(id) ON DELETE SET NULL;

-- 5. Create sales_leads table
CREATE TABLE IF NOT EXISTS public.sales_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    company_name TEXT,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    expected_members INTEGER,
    expected_storage TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Enable Row Level Security (RLS) on all tables
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;

-- 7. Policies
CREATE POLICY select_public_plans ON public.plans FOR SELECT USING (true);

CREATE POLICY select_own_billing ON public.billing_accounts FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY insert_own_billing ON public.billing_accounts FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY select_own_subscription ON public.subscriptions FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.billing_accounts ba 
        WHERE ba.id = billing_account_id AND ba.owner_id = auth.uid()
    )
);

CREATE POLICY insert_own_sales_lead ON public.sales_leads FOR INSERT WITH CHECK (user_id = auth.uid() OR auth.uid() IS NULL);

-- 8. Triggers for updated_at
CREATE OR REPLACE TRIGGER set_plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER set_billing_accounts_updated_at BEFORE UPDATE ON public.billing_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER set_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER set_sales_leads_updated_at BEFORE UPDATE ON public.sales_leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
