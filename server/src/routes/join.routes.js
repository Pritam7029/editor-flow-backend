const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { requireWorkspaceRole, requireWorkspaceMember } = require('../services/workspaceAccess.service');
const { getPlanLimitsForWorkspace } = require('../middleware/planEnforcement');

const router = express.Router();

/**
 * POST /api/workspaces/:workspaceId/join-links
 * Create a workspace join link (Admin/Owner only)
 */
router.post('/workspaces/:workspaceId/join-links', requireAuth, async (req, res, next) => {
    try {
        const { workspaceId } = req.params;
        const { defaultRequestedRole, expiresInDays, maxUses } = req.body;

        // Authorize - Admin/Owner only
        await requireWorkspaceRole(req.user.id, workspaceId, ['owner', 'admin']);

        // Generate token and token_hash
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        let expiresAt = null;
        if (expiresInDays) {
            expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
        }

        const { data: joinLink, error } = await supabaseAdmin
            .from('workspace_join_links')
            .insert({
                workspace_id: workspaceId,
                token_hash: tokenHash,
                created_by: req.user.id,
                default_requested_role: defaultRequestedRole || 'editor',
                expires_at: expiresAt,
                max_uses: maxUses ? Number(maxUses) : null,
                status: 'active'
            })
            .select()
            .single();

        if (error) throw error;

        // Return raw token to the user (not saved in database)
        return res.status(201).json({
            success: true,
            message: 'Join link created successfully',
            data: {
                ...joinLink,
                token
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/join-links/:token
 * Validate a join link token and return basic workspace info
 */
router.get('/join-links/:token', async (req, res, next) => {
    try {
        const { token } = req.params;
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const { data: link, error: linkError } = await supabaseAdmin
            .from('workspace_join_links')
            .select('*')
            .eq('token_hash', tokenHash)
            .eq('status', 'active')
            .maybeSingle();

        if (linkError || !link) {
            return res.status(404).json({
                success: false,
                message: 'Invalid or disabled join link'
            });
        }

        // Check expiration
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Join link has expired'
            });
        }

        // Check uses
        if (link.max_uses && link.use_count >= link.max_uses) {
            return res.status(400).json({
                success: false,
                message: 'Join link has reached its maximum usage limit'
            });
        }

        // Fetch workspace details
        const { data: workspace, error: wsError } = await supabaseAdmin
            .from('workspaces')
            .select('id, name')
            .eq('id', link.workspace_id)
            .single();

        if (wsError || !workspace) {
            return res.status(404).json({
                success: false,
                message: 'Workspace not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Join link verified',
            data: {
                workspace: {
                    id: workspace.id,
                    name: workspace.name
                },
                defaultRequestedRole: link.default_requested_role
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/join-links/:token/request
 * Request access to join workspace via token (requires user authenticated session)
 */
router.post('/join-links/:token/request', requireAuth, async (req, res, next) => {
    try {
        const { token } = req.params;
        const { message, requestedRole } = req.body;
        const userId = req.user.id;

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        // 1. Validate join link
        const { data: link, error: linkError } = await supabaseAdmin
            .from('workspace_join_links')
            .select('*')
            .eq('token_hash', tokenHash)
            .eq('status', 'active')
            .maybeSingle();

        if (linkError || !link) {
            return res.status(404).json({
                success: false,
                message: 'Invalid or disabled join link'
            });
        }

        // Check expiration
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Join link has expired'
            });
        }

        // Check uses
        if (link.max_uses && link.use_count >= link.max_uses) {
            return res.status(400).json({
                success: false,
                message: 'Join link has reached its maximum usage limit'
            });
        }

        // 2. Check if already workspace member
        const { data: member } = await supabaseAdmin
            .from('workspace_members')
            .select('id')
            .eq('workspace_id', link.workspace_id)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();

        if (member) {
            return res.status(400).json({
                success: false,
                message: 'You are already an active member of this workspace'
            });
        }

        // 3. Check for existing pending request
        const { data: existingRequest } = await supabaseAdmin
            .from('workspace_join_requests')
            .select('id')
            .eq('workspace_id', link.workspace_id)
            .eq('requester_id', userId)
            .eq('status', 'pending')
            .maybeSingle();

        if (existingRequest) {
            return res.status(400).json({
                success: false,
                message: 'You already have a pending request to join this workspace'
            });
        }

        // 4. Create request
        const { data: request, error: reqError } = await supabaseAdmin
            .from('workspace_join_requests')
            .insert({
                workspace_id: link.workspace_id,
                join_link_id: link.id,
                requester_id: userId,
                requested_role: requestedRole || link.default_requested_role || 'editor',
                message: message || null,
                status: 'pending'
            })
            .select()
            .single();

        if (reqError) throw reqError;

        return res.status(201).json({
            success: true,
            message: 'Join request submitted successfully. Waiting for admin approval.',
            data: { request }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/join-requests
 * Get all join requests for a workspace (Admin/Owner only)
 */
router.get('/workspaces/:workspaceId/join-requests', requireAuth, async (req, res, next) => {
    try {
        const { workspaceId } = req.params;

        // Authorize - Admin/Owner only
        await requireWorkspaceRole(req.user.id, workspaceId, ['owner', 'admin']);

        // Fetch join requests
        const { data: requests, error } = await supabaseAdmin
            .from('workspace_join_requests')
            .select(`
                *,
                requester:profiles!workspace_join_requests_requester_id_fkey (
                    id,
                    email,
                    full_name,
                    avatar_url,
                    color
                )
            `)
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Join requests fetched successfully',
            data: { requests }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/join-requests/:requestId/approve
 * Approve workspace join request (Admin/Owner only, enforces plan member limit)
 */
router.post('/workspaces/:workspaceId/join-requests/:requestId/approve', requireAuth, async (req, res, next) => {
    try {
        const { workspaceId, requestId } = req.params;

        // 1. Authorize - Admin/Owner only
        await requireWorkspaceRole(req.user.id, workspaceId, ['owner', 'admin']);

        // 2. Fetch the request
        const { data: request, error: reqError } = await supabaseAdmin
            .from('workspace_join_requests')
            .select('*')
            .eq('id', requestId)
            .eq('workspace_id', workspaceId)
            .single();

        if (reqError || !request) {
            return res.status(404).json({
                success: false,
                message: 'Join request not found'
            });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Cannot approve a request that is already ${request.status}`
            });
        }

        // 3. Enforce member limit check
        const limits = await getPlanLimitsForWorkspace(workspaceId);
        const { count: currentMemberCount, error: countError } = await supabaseAdmin
            .from('workspace_members')
            .select('*', { count: 'exact', head: true })
            .eq('workspace_id', workspaceId)
            .eq('status', 'active');

        if (countError) throw countError;

        if (currentMemberCount >= limits.max_members) {
            return res.status(403).json({
                success: false,
                code: 'PLAN_LIMIT_EXCEEDED',
                message: `This workspace has reached the limit of ${limits.max_members} active members allowed by the owner's plan.`
            });
        }

        // 4. Update request status to 'approved'
        const { error: requestUpdateError } = await supabaseAdmin
            .from('workspace_join_requests')
            .update({
                status: 'approved',
                reviewed_by: req.user.id,
                reviewed_at: new Date(),
                updated_at: new Date()
            })
            .eq('id', requestId);

        if (requestUpdateError) throw requestUpdateError;

        // 5. Add to workspace members
        const { data: member, error: memberError } = await supabaseAdmin
            .from('workspace_members')
            .insert({
                workspace_id: workspaceId,
                user_id: request.requester_id,
                role: request.requested_role || 'editor',
                status: 'active',
                joined_at: new Date()
            })
            .select()
            .single();

        if (memberError) throw memberError;

        // 6. Update usage count of the associated join link
        if (request.join_link_id) {
            try {
                const { data: link } = await supabaseAdmin
                    .from('workspace_join_links')
                    .select('use_count')
                    .eq('id', request.join_link_id)
                    .single();
                if (link) {
                    await supabaseAdmin
                        .from('workspace_join_links')
                        .update({ use_count: (link.use_count || 0) + 1 })
                        .eq('id', request.join_link_id);
                }
            } catch (err) {
                console.error('Failed to update join link use count:', err);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Join request approved and member added successfully',
            data: { member }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/join-requests/:requestId/reject
 * Reject workspace join request (Admin/Owner only)
 */
router.post('/workspaces/:workspaceId/join-requests/:requestId/reject', requireAuth, async (req, res, next) => {
    try {
        const { workspaceId, requestId } = req.params;

        // 1. Authorize - Admin/Owner only
        await requireWorkspaceRole(req.user.id, workspaceId, ['owner', 'admin']);

        // 2. Fetch the request
        const { data: request, error: reqError } = await supabaseAdmin
            .from('workspace_join_requests')
            .select('*')
            .eq('id', requestId)
            .eq('workspace_id', workspaceId)
            .single();

        if (reqError || !request) {
            return res.status(404).json({
                success: false,
                message: 'Join request not found'
            });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Cannot reject a request that is already ${request.status}`
            });
        }

        // 3. Update request status to 'rejected'
        const { data: updatedRequest, error: requestUpdateError } = await supabaseAdmin
            .from('workspace_join_requests')
            .update({
                status: 'rejected',
                reviewed_by: req.user.id,
                reviewed_at: new Date(),
                updated_at: new Date()
            })
            .eq('id', requestId)
            .select()
            .single();

        if (requestUpdateError) throw requestUpdateError;

        return res.status(200).json({
            success: true,
            message: 'Join request rejected successfully',
            data: { request: updatedRequest }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
