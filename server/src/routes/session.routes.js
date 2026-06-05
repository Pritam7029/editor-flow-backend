const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.get('/bootstrap', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const email = req.user.email;

        // 1. Fetch or initialize profile
        let { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        if (profileError) {
            throw profileError;
        }

        if (!profile) {
            const profilePayload = {
                id: userId,
                email: email,
                full_name: req.user.user_metadata && (req.user.user_metadata.full_name || req.user.user_metadata.name) ?
                    req.user.user_metadata.full_name || req.user.user_metadata.name :
                    null,
                avatar_url: req.user.user_metadata && req.user.user_metadata.avatar_url ?
                    req.user.user_metadata.avatar_url :
                    null
            };

            const { data: newProfile, error: createError } = await supabaseAdmin
                .from('profiles')
                .insert(profilePayload)
                .select()
                .single();

            if (createError) {
                throw createError;
            }
            profile = newProfile;
        }

        // 2. Fetch billing account
        const { data: billingAccount, error: billingError } = await supabaseAdmin
            .from('billing_accounts')
            .select('*')
            .eq('owner_id', userId)
            .maybeSingle();

        // 3. Fetch workspace memberships
        const { data: memberships, error: memberError } = await supabaseAdmin
            .from('workspace_members')
            .select(`
                id,
                role,
                status,
                joined_at,
                workspace:workspaces (
                    id,
                    name,
                    owner_id,
                    created_at,
                    updated_at
                )
            `)
            .eq('user_id', userId)
            .eq('status', 'active');

        if (memberError) {
            throw memberError;
        }

        const ownedWorkspaces = [];
        const memberWorkspaces = [];

        if (memberships) {
            memberships.forEach((m) => {
                if (m.workspace) {
                    const wsData = {
                        id: m.workspace.id,
                        name: m.workspace.name,
                        owner_id: m.workspace.owner_id,
                        created_at: m.workspace.created_at,
                        updated_at: m.workspace.updated_at,
                        role: m.role,
                        joined_at: m.joined_at
                    };
                    if (m.role === 'owner' || m.workspace.owner_id === userId) {
                        ownedWorkspaces.push(wsData);
                    } else {
                        memberWorkspaces.push(wsData);
                    }
                }
            });
        }

        // 4. Fetch pending join requests
        const { data: pendingRequests, error: reqError } = await supabaseAdmin
            .from('workspace_join_requests')
            .select('*')
            .eq('requester_id', userId)
            .eq('status', 'pending');

        const pendingJoinRequest = pendingRequests && pendingRequests.length > 0 ? pendingRequests[0] : null;

        // 5. Determine next route logic
        let nextRoute = '/dashboard';
        const totalWorkspaces = ownedWorkspaces.length + memberWorkspaces.length;

        if (totalWorkspaces === 0) {
            if (!billingAccount) {
                nextRoute = '/onboarding/plan';
            } else {
                nextRoute = '/dashboard';
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Session bootstrapped successfully',
            data: {
                profile,
                billingAccount,
                ownedWorkspaces,
                memberWorkspaces,
                pendingJoinRequest,
                nextRoute
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
