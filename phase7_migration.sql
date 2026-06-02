-- Phase 7 Schema Migration: Profile Customization & Status Management

-- 1. Add role, bio, and status columns to public.profiles if they don't already exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Index on status for active search/filters
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles (status);
