const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const validate = require('../validators/validate');

const {
    requireWorkspaceMember
} = require('../services/workspaceAccess.service');

const {
    createFilesSchema,
    updatePermissionsSchema,
    createFileCommentSchema
} = require('../validators/file.validators');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/**
 * GET /api/workspaces/:workspaceId/files
 * Fetch all files visible to the current member (hydrated with feedback comments & authors)
 */
router.get('/files', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;

        // Verify membership access
        const membership = await requireWorkspaceMember(req.user.id, workspaceId);

        // Fetch workspace detail to check owner ID
        const { data: ws, error: wsError } = await supabaseAdmin
            .from('workspaces')
            .select('owner_id')
            .eq('id', workspaceId)
            .single();

        if (wsError || !ws) {
            throw wsError || new Error('Workspace not found');
        }

        const isOwner = ws.owner_id === req.user.id;
        const isAdmin = isOwner || membership.role === 'admin';

        // Fetch all files for workspace
        const { data: files, error: filesError } = await supabaseAdmin
            .from('workspace_files')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false });

        if (filesError) throw filesError;

        // Apply RBAC filters: Admins/Owners see all; editors see their own uploads or files visible to them
        const visibleFiles = (files || []).filter(file => {
            if (isAdmin) return true;
            if (file.uploaded_by === req.user.id) return true;
            if (!file.visible_to || file.visible_to.length === 0) return false;
            return file.visible_to.includes(req.user.id);
        });

        // Hydrate feedback comments for visible files
        let comments = [];
        const visibleFileIds = visibleFiles.map(f => f.id);
        if (visibleFileIds.length > 0) {
            const { data: fetchedComments, error: commentsError } = await supabaseAdmin
                .from('file_comments')
                .select(`
                    id,
                    file_id,
                    author_id,
                    text,
                    timestamp,
                    created_at,
                    author:profiles (
                        full_name,
                        email
                    )
                `)
                .in('file_id', visibleFileIds)
                .order('created_at', { ascending: true });

            if (commentsError) throw commentsError;
            comments = fetchedComments || [];
        }

        const commentsByFileId = {};
        comments.forEach(c => {
            commentsByFileId[c.file_id] = commentsByFileId[c.file_id] || [];
            commentsByFileId[c.file_id].push({
                id: c.id,
                authorId: c.author_id,
                authorName: c.author?.full_name || c.author?.email || 'Unknown',
                text: c.text,
                timestamp: c.timestamp,
                ts: new Date(c.created_at).getTime()
            });
        });

        const hydratedFiles = visibleFiles.map(file => ({
            id: file.id,
            workspace_id: file.workspace_id,
            name: file.name,
            type: file.type,
            size: file.size ? Number(file.size) : null,
            dataUrl: file.data_url || null,
            uploadedBy: file.uploaded_by,
            uploadedAt: new Date(file.created_at).getTime(),
            visibleTo: file.visible_to || [],
            comments: commentsByFileId[file.id] || []
        }));

        return res.status(200).json({
            success: true,
            message: 'Files fetched successfully',
            data: { files: hydratedFiles }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/files
 * Register uploaded files
 */
router.post('/files', validate(createFilesSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { files } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const insertData = files.map(f => ({
            id: f.id || undefined,
            workspace_id: workspaceId,
            name: f.name,
            type: f.type,
            size: f.size || null,
            data_url: f.dataUrl || null,
            uploaded_by: req.user.id,
            visible_to: f.visibleTo && f.visibleTo.length > 0 ? f.visibleTo : null
        }));

        const { data: insertedFiles, error: insertError } = await supabaseAdmin
            .from('workspace_files')
            .insert(insertData)
            .select();

        if (insertError) throw insertError;

        const hydrated = (insertedFiles || []).map(file => ({
            id: file.id,
            workspace_id: file.workspace_id,
            name: file.name,
            type: file.type,
            size: file.size ? Number(file.size) : null,
            dataUrl: file.data_url || null,
            uploadedBy: file.uploaded_by,
            uploadedAt: new Date(file.created_at).getTime(),
            visibleTo: file.visible_to || [],
            comments: []
        }));

        return res.status(201).json({
            success: true,
            message: 'Files registered successfully',
            data: { files: hydrated }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/workspaces/:workspaceId/files/:fileId
 * Delete a file
 */
router.delete('/files/:fileId', async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.params;

        const membership = await requireWorkspaceMember(req.user.id, workspaceId);

        // Fetch file to verify ownership
        const { data: file, error: fileError } = await supabaseAdmin
            .from('workspace_files')
            .select('*')
            .eq('id', fileId)
            .eq('workspace_id', workspaceId)
            .single();

        if (fileError || !file) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Fetch workspace detail to check owner ID
        const { data: ws, error: wsError } = await supabaseAdmin
            .from('workspaces')
            .select('owner_id')
            .eq('id', workspaceId)
            .single();

        if (wsError || !ws) {
            throw wsError || new Error('Workspace not found');
        }

        const isOwner = ws.owner_id === req.user.id;
        const isUploader = file.uploaded_by === req.user.id;

        // Deletion permissions: Only owner, admin, or the file uploader
        if (!isOwner && !isUploader && membership.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to delete this file'
            });
        }

        const { error: deleteError } = await supabaseAdmin
            .from('workspace_files')
            .delete()
            .eq('id', fileId)
            .eq('workspace_id', workspaceId);

        if (deleteError) throw deleteError;

        return res.status(200).json({
            success: true,
            message: 'File deleted successfully',
            data: null
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/workspaces/:workspaceId/files/:fileId/permissions
 * Update file collaborator permissions visibility list
 */
router.patch('/files/:fileId/permissions', validate(updatePermissionsSchema), async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.validated.params;
        const { visibleTo } = req.validated.body;

        const membership = await requireWorkspaceMember(req.user.id, workspaceId);

        // Fetch file to verify uploader
        const { data: file, error: fileError } = await supabaseAdmin
            .from('workspace_files')
            .select('*')
            .eq('id', fileId)
            .eq('workspace_id', workspaceId)
            .single();

        if (fileError || !file) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Fetch workspace detail to check owner ID
        const { data: ws, error: wsError } = await supabaseAdmin
            .from('workspaces')
            .select('owner_id')
            .eq('id', workspaceId)
            .single();

        if (wsError || !ws) {
            throw wsError || new Error('Workspace not found');
        }

        const isOwner = ws.owner_id === req.user.id;
        const isUploader = file.uploaded_by === req.user.id;

        // Permissions edit: Only owner, admin, or uploader
        if (!isOwner && !isUploader && membership.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to modify this file'
            });
        }

        const { data: updatedFile, error: updateError } = await supabaseAdmin
            .from('workspace_files')
            .update({
                visible_to: visibleTo && visibleTo.length > 0 ? visibleTo : null,
                updated_at: new Date()
            })
            .eq('id', fileId)
            .eq('workspace_id', workspaceId)
            .select()
            .single();

        if (updateError) throw updateError;

        return res.status(200).json({
            success: true,
            message: 'File permissions updated successfully',
            data: { visibleTo: updatedFile.visible_to || [] }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/files/:fileId/comments
 * Add review comment to file (optionally with video seek timestamp)
 */
router.post('/files/:fileId/comments', validate(createFileCommentSchema), async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.validated.params;
        const { text, timestamp } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: comment, error: insertError } = await supabaseAdmin
            .from('file_comments')
            .insert({
                workspace_id: workspaceId,
                file_id: fileId,
                author_id: req.user.id,
                text,
                timestamp: timestamp !== undefined ? timestamp : null
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // Fetch author profile
        const { data: author } = await supabaseAdmin
            .from('profiles')
            .select('full_name, email')
            .eq('id', req.user.id)
            .single();

        const hydratedComment = {
            id: comment.id,
            authorId: comment.author_id,
            authorName: author.full_name || author.email || 'Unknown',
            text: comment.text,
            timestamp: comment.timestamp,
            ts: new Date(comment.created_at).getTime()
        };

        return res.status(201).json({
            success: true,
            message: 'Comment added successfully',
            data: { comment: hydratedComment }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
