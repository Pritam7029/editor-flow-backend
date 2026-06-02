const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const validate = require('../validators/validate');

const {
    workspaceIdParamSchema,
    createWorkspaceSchema,
    updateWorkspaceSchema
} = require('../validators/workspace.validators');

const {
    createInviteSchema,
    updateMemberSchema,
    removeMemberSchema
} = require('../validators/invite.validators');

const {
    requireWorkspaceMember,
    requireWorkspaceRole
} = require('../services/workspaceAccess.service');

const { sendWorkspaceInvite } = require('../services/emailService');

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/workspaces
 * Get all active workspaces for the logged-in user
 */
router.get('/', async(req, res, next) => {
    try {
        const { data: memberships, error } = await supabaseAdmin
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
            .eq('user_id', req.user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true });

        if (error) {
            throw error;
        }

        const workspaces = (memberships || []).map((membership) => ({
            membership_id: membership.id,
            role: membership.role,
            status: membership.status,
            joined_at: membership.joined_at,
            ...membership.workspace
        }));

        return res.status(200).json({
            success: true,
            message: 'Workspaces fetched successfully',
            data: {
                workspaces
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces
 * Create a workspace and make logged-in user the owner
 */
router.post('/', validate(createWorkspaceSchema), async(req, res, next) => {
    try {
        const { name } = req.validated.body;

        const profilePayload = {
            id: req.user.id,
            email: req.user.email,
            full_name: req.user.user_metadata &&
                (req.user.user_metadata.full_name || req.user.user_metadata.name) ?
                req.user.user_metadata.full_name || req.user.user_metadata.name :
                null,
            avatar_url: req.user.user_metadata && req.user.user_metadata.avatar_url ?
                req.user.user_metadata.avatar_url :
                null
        };

        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert(profilePayload, {
                onConflict: 'id'
            });

        if (profileError) {
            throw profileError;
        }

        const { data: workspaceId, error: rpcError } = await supabaseAdmin
            .rpc('create_workspace_for_user', {
                p_owner_id: req.user.id,
                p_name: name
            });

        if (rpcError) {
            throw rpcError;
        }

        const { data: workspace, error: workspaceError } = await supabaseAdmin
            .from('workspaces')
            .select('*')
            .eq('id', workspaceId)
            .single();

        if (workspaceError) {
            throw workspaceError;
        }

        return res.status(201).json({
            success: true,
            message: 'Workspace created successfully',
            data: {
                workspace
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId
 * Get one workspace if the user is an active member
 */
router.get(
    '/:workspaceId',
    validate(workspaceIdParamSchema),
    async(req, res, next) => {
        try {
            const { workspaceId } = req.validated.params;

            const membership = await requireWorkspaceMember(req.user.id, workspaceId);

            const { data: workspace, error } = await supabaseAdmin
                .from('workspaces')
                .select('*')
                .eq('id', workspaceId)
                .single();

            if (error) {
                throw error;
            }

            return res.status(200).json({
                success: true,
                message: 'Workspace fetched successfully',
                data: {
                    workspace,
                    membership
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * PATCH /api/workspaces/:workspaceId
 * Rename workspace. Owner/admin only.
 */
router.patch(
    '/:workspaceId',
    validate(updateWorkspaceSchema),
    async(req, res, next) => {
        try {
            const { workspaceId } = req.validated.params;
            const { name } = req.validated.body;

            await requireWorkspaceRole(req.user.id, workspaceId, ['owner', 'admin']);

            const { data: workspace, error } = await supabaseAdmin
                .from('workspaces')
                .update({
                    name
                })
                .eq('id', workspaceId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            return res.status(200).json({
                success: true,
                message: 'Workspace updated successfully',
                data: {
                    workspace
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * DELETE /api/workspaces/:workspaceId
 * Delete workspace. Owner only.
 */
router.delete(
    '/:workspaceId',
    validate(workspaceIdParamSchema),
    async(req, res, next) => {
        try {
            const { workspaceId } = req.validated.params;

            await requireWorkspaceRole(req.user.id, workspaceId, ['owner']);

            const { error } = await supabaseAdmin
                .from('workspaces')
                .delete()
                .eq('id', workspaceId);

            if (error) {
                throw error;
            }

            return res.status(200).json({
                success: true,
                message: 'Workspace deleted successfully',
                data: null
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * GET /api/workspaces/:workspaceId/members
 * Get active members of a workspace
 */
router.get(
    '/:workspaceId/members',
    validate(workspaceIdParamSchema),
    async(req, res, next) => {
        try {
            const { workspaceId } = req.validated.params;

            await requireWorkspaceMember(req.user.id, workspaceId);

            const { data: members, error: membersError } = await supabaseAdmin
                .from('workspace_members')
                .select('*')
                .eq('workspace_id', workspaceId)
                .eq('status', 'active')
                .order('created_at', { ascending: true });

            if (membersError) {
                throw membersError;
            }

            const userIds = (members || []).map((member) => member.user_id);

            let profiles = [];

            if (userIds.length > 0) {
                const { data: profileRows, error: profilesError } = await supabaseAdmin
                    .from('profiles')
                    .select('id, email, full_name, avatar_url, color')
                    .in('id', userIds);

                if (profilesError) {
                    throw profilesError;
                }

                profiles = profileRows || [];
            }

            const profileMap = new Map(
                profiles.map((profile) => [profile.id, profile])
            );

            const hydratedMembers = (members || []).map((member) => ({
                ...member,
                profile: profileMap.get(member.user_id) || null
            }));

            return res.status(200).json({
                success: true,
                message: 'Workspace members fetched successfully',
                data: {
                    members: hydratedMembers
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * POST /api/workspaces/:workspaceId/invites
 * Send an invitation to join the workspace
 */
router.post(
    '/:workspaceId/invites',
    validate(createInviteSchema),
    async (req, res, next) => {
        try {
            const { workspaceId } = req.validated.params;
            const { email, role } = req.validated.body;

            // 1. Authorize - Requester must be admin or owner
            await requireWorkspaceRole(req.user.id, workspaceId, ['owner', 'admin']);

            // 2. Check if user is already an active member of this workspace
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('email', email)
                .maybeSingle();

            if (profile) {
                const { data: activeMember } = await supabaseAdmin
                    .from('workspace_members')
                    .select('*')
                    .eq('workspace_id', workspaceId)
                    .eq('user_id', profile.id)
                    .eq('status', 'active')
                    .maybeSingle();

                if (activeMember) {
                    return res.status(400).json({
                        success: false,
                        message: 'This user is already an active member of this workspace'
                    });
                }
            }

            // 3. Check for existing active invite
            const { data: existingInvite } = await supabaseAdmin
                .from('workspace_invites')
                .select('*')
                .eq('workspace_id', workspaceId)
                .eq('email', email)
                .eq('status', 'invited')
                .maybeSingle();

            let invite;
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days expiration

            if (existingInvite) {
                // Update/renew active invite
                const { data: updatedInvite, error: updateError } = await supabaseAdmin
                    .from('workspace_invites')
                    .update({
                        token,
                        expires_at: expiresAt,
                        invited_by: req.user.id,
                        role,
                        updated_at: new Date()
                    })
                    .eq('id', existingInvite.id)
                    .select()
                    .single();

                if (updateError) throw updateError;
                invite = updatedInvite;
            } else {
                // Create new invite
                const { data: newInvite, error: insertError } = await supabaseAdmin
                    .from('workspace_invites')
                    .insert({
                        workspace_id: workspaceId,
                        email,
                        role,
                        invited_by: req.user.id,
                        token,
                        expires_at: expiresAt
                    })
                    .select()
                    .single();

                if (insertError) throw insertError;
                invite = newInvite;
            }

            // 4. Fetch details to personalize invite email
            const { data: workspace } = await supabaseAdmin
                .from('workspaces')
                .select('name')
                .eq('id', workspaceId)
                .single();

            const { data: inviter } = await supabaseAdmin
                .from('profiles')
                .select('full_name, email')
                .eq('id', req.user.id)
                .single();

            const inviterName = inviter.full_name || inviter.email || 'A team member';

            // 5. Send transactional email
            await sendWorkspaceInvite({
                email,
                inviteToken: token,
                workspaceName: workspace.name,
                inviterName
            });

            return res.status(201).json({
                success: true,
                message: 'Invitation sent successfully',
                data: {
                    invite
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * PATCH /api/workspaces/:workspaceId/members/:memberId
 * Update membership role (Owner/Admin only, prevent owner changes)
 */
router.patch(
    '/:workspaceId/members/:memberId',
    validate(updateMemberSchema),
    async (req, res, next) => {
        try {
            const { workspaceId, memberId } = req.validated.params;
            const { role } = req.validated.body;

            // 1. Requester must be admin or owner
            await requireWorkspaceRole(req.user.id, workspaceId, ['owner', 'admin']);

            // 2. Fetch workspace to identify owner
            const { data: workspace } = await supabaseAdmin
                .from('workspaces')
                .select('owner_id')
                .eq('id', workspaceId)
                .single();

            // 3. Fetch member to update
            const { data: memberToUpdate, error: fetchError } = await supabaseAdmin
                .from('workspace_members')
                .select('*')
                .eq('id', memberId)
                .single();

            if (fetchError || !memberToUpdate) {
                return res.status(404).json({
                    success: false,
                    message: 'Workspace member not found'
                });
            }

            // 4. Block owner modifications
            if (memberToUpdate.user_id === workspace.owner_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Cannot update the role of the workspace owner'
                });
            }

            // 5. Apply update
            const { data: updatedMember, error: updateError } = await supabaseAdmin
                .from('workspace_members')
                .update({
                    role,
                    updated_at: new Date()
                })
                .eq('id', memberId)
                .select()
                .single();

            if (updateError) throw updateError;

            return res.status(200).json({
                success: true,
                message: 'Member role updated successfully',
                data: {
                    member: updatedMember
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * DELETE /api/workspaces/:workspaceId/members/:memberId
 * Remove member from workspace (Owner/Admin only)
 */
router.delete(
    '/:workspaceId/members/:memberId',
    validate(removeMemberSchema),
    async (req, res, next) => {
        try {
            const { workspaceId, memberId } = req.validated.params;

            // 1. Requester must be admin or owner
            const requesterMembership = await requireWorkspaceRole(req.user.id, workspaceId, ['owner', 'admin']);

            // 2. Fetch workspace to identify owner
            const { data: workspace } = await supabaseAdmin
                .from('workspaces')
                .select('owner_id')
                .eq('id', workspaceId)
                .single();

            // 3. Fetch member to delete
            const { data: memberToDelete, error: fetchError } = await supabaseAdmin
                .from('workspace_members')
                .select('*')
                .eq('id', memberId)
                .single();

            if (fetchError || !memberToDelete) {
                return res.status(404).json({
                    success: false,
                    message: 'Workspace member not found'
                });
            }

            // 4. Block owner removal
            if (memberToDelete.user_id === workspace.owner_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Cannot remove the workspace owner'
                });
            }

            // 5. Admins cannot remove other admins
            if (requesterMembership.role === 'admin' && memberToDelete.role === 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Admins cannot remove other admins'
                });
            }

            // 6. Delete membership or update status to 'removed'
            const { error: deleteError } = await supabaseAdmin
                .from('workspace_members')
                .update({
                    status: 'removed',
                    updated_at: new Date()
                })
                .eq('id', memberId);

            if (deleteError) throw deleteError;

            return res.status(200).json({
                success: true,
                message: 'Member removed successfully',
                data: null
            });
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;