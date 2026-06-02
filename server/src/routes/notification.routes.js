const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const validate = require('../validators/validate');

const {
    requireWorkspaceMember
} = require('../services/workspaceAccess.service');

const {
    createNotificationSchema,
    markReadSchema
} = require('../validators/notification.validators');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/**
 * GET /api/workspaces/:workspaceId/notifications
 * Fetch all notifications visible to the current member
 */
router.get('/notifications', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        // Fetch all workspace notifications
        const { data, error } = await supabaseAdmin
            .from('workspace_notifications')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Filter: recipient_id is null (global) or matches the current user's ID
        const filteredData = (data || []).filter(n => !n.recipient_id || n.recipient_id === req.user.id);

        const hydrated = filteredData.map(n => ({
            id: n.id,
            icon: n.icon,
            iconClass: n.icon_class,
            title: n.title,
            sub: n.sub,
            targetEditorId: n.recipient_id || null,
            ts: new Date(n.created_at).getTime(),
            read: n.read
        }));

        return res.status(200).json({
            success: true,
            message: 'Notifications fetched successfully',
            data: { notifications: hydrated }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/notifications
 * Post a new notification in workspace
 */
router.post('/notifications', validate(createNotificationSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { icon, iconClass, title, sub, targetEditorId } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: notif, error } = await supabaseAdmin
            .from('workspace_notifications')
            .insert({
                workspace_id: workspaceId,
                recipient_id: targetEditorId || null,
                icon,
                icon_class: iconClass,
                title,
                sub
            })
            .select()
            .single();

        if (error) throw error;

        const formatted = {
            id: notif.id,
            icon: notif.icon,
            iconClass: notif.icon_class,
            title: notif.title,
            sub: notif.sub,
            targetEditorId: notif.recipient_id || null,
            ts: new Date(notif.created_at).getTime(),
            read: notif.read
        };

        return res.status(201).json({
            success: true,
            message: 'Notification posted successfully',
            data: { notification: formatted }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/workspaces/:workspaceId/notifications/:notificationId/read
 * Mark notification as read
 */
router.patch('/notifications/:notificationId/read', validate(markReadSchema), async (req, res, next) => {
    try {
        const { workspaceId, notificationId } = req.validated.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: notif, error } = await supabaseAdmin
            .from('workspace_notifications')
            .update({ read: true })
            .eq('id', notificationId)
            .eq('workspace_id', workspaceId)
            .select()
            .single();

        if (error) throw error;

        const formatted = {
            id: notif.id,
            icon: notif.icon,
            iconClass: notif.icon_class,
            title: notif.title,
            sub: notif.sub,
            targetEditorId: notif.recipient_id || null,
            ts: new Date(notif.created_at).getTime(),
            read: notif.read
        };

        return res.status(200).json({
            success: true,
            message: 'Notification marked as read',
            data: { notification: formatted }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/workspaces/:workspaceId/notifications
 * Clear active notifications for the current user in workspace
 */
router.delete('/notifications', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        // Fetch existing notification IDs visible to the current user
        const { data, error: fetchError } = await supabaseAdmin
            .from('workspace_notifications')
            .select('id, recipient_id')
            .eq('workspace_id', workspaceId);

        if (fetchError) throw fetchError;

        const idsToDelete = (data || [])
            .filter(n => !n.recipient_id || n.recipient_id === req.user.id)
            .map(n => n.id);

        if (idsToDelete.length > 0) {
            const { error: deleteError } = await supabaseAdmin
                .from('workspace_notifications')
                .delete()
                .in('id', idsToDelete);

            if (deleteError) throw deleteError;
        }

        return res.status(200).json({
            success: true,
            message: 'Notifications cleared successfully',
            data: null
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
