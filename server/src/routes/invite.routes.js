const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const validate = require('../validators/validate');
const { resolveInviteSchema, acceptInviteSchema } = require('../validators/invite.validators');
const { getPlanLimitsForWorkspace } = require('../middleware/planEnforcement');

const router = express.Router();

/**
 * GET /api/invites/:token
 * Resolve invitation details by invite token (Public endpoint)
 */
router.get('/:token', validate(resolveInviteSchema), async (req, res, next) => {
    try {
        const { token } = req.validated.params;

        // Use service role client to retrieve invite bypass RLS since guest has no access yet
        const { data: invite, error: inviteError } = await supabaseAdmin
            .from('workspace_invites')
            .select('*')
            .eq('token', token)
            .maybeSingle();

        if (inviteError) {
            throw inviteError;
        }

        if (!invite) {
            return res.status(404).json({
                success: false,
                message: 'Invitation link is invalid or has expired'
            });
        }

        if (invite.status !== 'invited') {
            return res.status(400).json({
                success: false,
                message: `This invitation has already been ${invite.status}`
            });
        }

        const now = new Date();
        const expiresAt = new Date(invite.expires_at);
        if (expiresAt < now) {
            return res.status(400).json({
                success: false,
                message: 'This invitation has expired'
            });
        }

        // Fetch workspace name
        const { data: workspace, error: wsError } = await supabaseAdmin
            .from('workspaces')
            .select('name')
            .eq('id', invite.workspace_id)
            .single();

        if (wsError) {
            throw wsError;
        }

        // Fetch inviter profile
        const { data: inviter, error: inviterError } = await supabaseAdmin
            .from('profiles')
            .select('full_name, email')
            .eq('id', invite.invited_by)
            .maybeSingle();

        return res.status(200).json({
            success: true,
            message: 'Invitation details resolved successfully',
            data: {
                invite: {
                    id: invite.id,
                    email: invite.email,
                    role: invite.role,
                    workspace_id: invite.workspace_id,
                    workspace_name: workspace.name,
                    inviter_name: inviter?.full_name || inviter?.email || 'A team member'
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/invites/:token/accept
 * Accept workspace invitation (Authenticated endpoint)
 */
router.post('/:token/accept', requireAuth, validate(acceptInviteSchema), async (req, res, next) => {
    try {
        const { token } = req.validated.params;
        const loggedInUser = req.user;

        // Fetch the invite
        const { data: invite, error: inviteError } = await supabaseAdmin
            .from('workspace_invites')
            .select('*')
            .eq('token', token)
            .maybeSingle();

        if (inviteError) {
            throw inviteError;
        }

        if (!invite) {
            return res.status(404).json({
                success: false,
                message: 'Invitation not found'
            });
        }

        if (invite.status !== 'invited') {
            return res.status(400).json({
                success: false,
                message: `This invitation has already been ${invite.status}`
            });
        }

        const now = new Date();
        const expiresAt = new Date(invite.expires_at);
        if (expiresAt < now) {
            return res.status(400).json({
                success: false,
                message: 'This invitation has expired'
            });
        }

        // Verify the logged-in user matches the invited email
        if (invite.email.toLowerCase() !== loggedInUser.email.toLowerCase()) {
            return res.status(403).json({
                success: false,
                message: `This invitation was sent to ${invite.email}, but you are logged in as ${loggedInUser.email}`
            });
        }

        // Verify or create their user profile to make sure they have a profile row
        const profilePayload = {
            id: loggedInUser.id,
            email: loggedInUser.email,
            full_name: loggedInUser.user_metadata?.full_name || loggedInUser.user_metadata?.name || null,
            avatar_url: loggedInUser.user_metadata?.avatar_url || null
        };

        await supabaseAdmin.from('profiles').upsert(profilePayload, { onConflict: 'id' });

        // Check if already a member of this workspace
        const { data: existingMember, error: memberCheckError } = await supabaseAdmin
            .from('workspace_members')
            .select('*')
            .eq('workspace_id', invite.workspace_id)
            .eq('user_id', loggedInUser.id)
            .maybeSingle();

        if (memberCheckError) {
            throw memberCheckError;
        }

        if (existingMember) {
            // If already a member (e.g. they got re-added), just mark invite accepted
            await supabaseAdmin
                .from('workspace_invites')
                .update({ status: 'accepted', updated_at: new Date() })
                .eq('id', invite.id);

            return res.status(200).json({
                success: true,
                message: 'You are already a member of this workspace',
                data: {
                    workspaceId: invite.workspace_id
                }
            });
        }

        // Check plan member limits
        const limits = await getPlanLimitsForWorkspace(invite.workspace_id);
        const { count: currentMemberCount, error: countError } = await supabaseAdmin
            .from('workspace_members')
            .select('*', { count: 'exact', head: true })
            .eq('workspace_id', invite.workspace_id)
            .eq('status', 'active');

        if (countError) throw countError;

        if (currentMemberCount >= limits.max_members) {
            return res.status(403).json({
                success: false,
                code: 'PLAN_LIMIT_EXCEEDED',
                message: `This workspace has reached the limit of ${limits.max_members} active members allowed by the owner's plan.`
            });
        }

        // Add user as workspace member
        const { error: insertMemberError } = await supabaseAdmin
            .from('workspace_members')
            .insert({
                workspace_id: invite.workspace_id,
                user_id: loggedInUser.id,
                role: invite.role,
                status: 'active',
                joined_at: new Date()
            });

        if (insertMemberError) {
            throw insertMemberError;
        }

        // Mark the invite as accepted
        const { error: updateInviteError } = await supabaseAdmin
            .from('workspace_invites')
            .update({
                status: 'accepted',
                updated_at: new Date()
            })
            .eq('id', invite.id);

        if (updateInviteError) {
            throw updateInviteError;
        }

        return res.status(200).json({
            success: true,
            message: 'Workspace invitation accepted successfully',
            data: {
                workspaceId: invite.workspace_id
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
