const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const validate = require('../validators/validate');

const {
    workspaceIdParamSchema,
    createWorkspaceSchema,
    updateWorkspaceSchema
} = require('../validators/workspace.validators');

const {
    requireWorkspaceMember,
    requireWorkspaceRole
} = require('../services/workspaceAccess.service');

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

module.exports = router;