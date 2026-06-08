const express = require('express');
const { requireAuth } = require('../middleware/auth');
const validate = require('../validators/validate');
const { requireWorkspaceMember } = require('../services/workspaceAccess.service');

const {
    initUploadSchema,
    completeUploadSchema,
    createFileVersionSchema,
    createFileRevisionSchema,
    updateFileRevisionSchema,
    updatePermissionsSchema
} = require('../validators/file.validators');

const {
    initFileUploadService,
    createFileVersionService,
    completeUploadService,
    listWorkspaceFilesService,
    getFileDetailsService,
    deleteFileService,
    getFileRevisionsService,
    createFileRevisionService,
    updateFileRevisionService,
    deleteFileRevisionService,
    updateFilePermissionsService
} = require('../services/file.service');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/**
 * GET /api/workspaces/:workspaceId/files
 * Fetch all files for the workspace, with versions and formatted comments.
 */
router.get('/files', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;

        // Verify membership access
        await requireWorkspaceMember(req.user.id, workspaceId);

        const files = await listWorkspaceFilesService(workspaceId);

        return res.status(200).json({
            success: true,
            message: 'Files fetched successfully',
            data: { files }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/files/init-upload
 * Initialize a new file upload. Creates database rows and generates signed upload URL.
 */
router.post('/files/init-upload', validate(initUploadSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { name, size_bytes, mime_type } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const uploadDetails = await initFileUploadService(workspaceId, req.user.id, {
            name,
            size_bytes,
            mime_type
        });

        return res.status(201).json({
            success: true,
            message: 'Upload initialized successfully',
            data: uploadDetails
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/files/complete-upload
 * Marks the file and version as ready, and generates a pre-signed playback URL.
 */
router.post('/files/complete-upload', validate(completeUploadSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { fileId, versionId, durationSeconds } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const completedDetails = await completeUploadService(workspaceId, {
            fileId,
            versionId,
            durationSeconds
        });

        return res.status(200).json({
            success: true,
            message: 'Upload completed successfully',
            data: completedDetails
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/files/:fileId
 * Retrieve file details including versions and revisions.
 */
router.get('/files/:fileId', async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const file = await getFileDetailsService(workspaceId, fileId);

        return res.status(200).json({
            success: true,
            message: 'File details fetched successfully',
            data: { file }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/workspaces/:workspaceId/files/:fileId
 * Delete a file and its associated storage assets.
 */
router.delete('/files/:fileId', async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        await deleteFileService(workspaceId, fileId);

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
 * POST /api/workspaces/:workspaceId/files/:fileId/versions
 * Upload a new version of an existing file.
 */
router.post('/files/:fileId/versions', validate(createFileVersionSchema), async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.validated.params;
        const { name, size_bytes, mime_type } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const uploadDetails = await createFileVersionService(workspaceId, fileId, req.user.id, {
            name,
            size_bytes,
            mime_type
        });

        return res.status(201).json({
            success: true,
            message: 'New file version upload initialized',
            data: uploadDetails
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/files/:fileId/versions
 * Get versions of a file.
 */
router.get('/files/:fileId/versions', async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const details = await getFileDetailsService(workspaceId, fileId);

        return res.status(200).json({
            success: true,
            message: 'Versions fetched successfully',
            data: { versions: details.versions }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/files/:fileId/revisions
 * Fetch all revisions for a file.
 */
router.get('/files/:fileId/revisions', async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const revisions = await getFileRevisionsService(workspaceId, fileId);

        return res.status(200).json({
            success: true,
            message: 'Revisions fetched successfully',
            data: { revisions }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/files/:fileId/revisions
 * Add a new comment revision linked to a version and timestamp.
 */
router.post('/files/:fileId/revisions', validate(createFileRevisionSchema), async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.validated.params;
        const { fileVersionId, timestampSeconds, body, priority } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const revision = await createFileRevisionService(workspaceId, fileId, req.user.id, {
            fileVersionId,
            timestampSeconds,
            body,
            priority
        });

        return res.status(201).json({
            success: true,
            message: 'Revision created successfully',
            data: { comment: revision }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/workspaces/:workspaceId/files/:fileId/revisions/:revisionId
 * Update a revision (e.g. edit text, priority, or resolve it).
 */
router.patch('/files/:fileId/revisions/:revisionId', validate(updateFileRevisionSchema), async (req, res, next) => {
    try {
        const { workspaceId, fileId, revisionId } = req.validated.params;
        const payload = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const revision = await updateFileRevisionService(workspaceId, fileId, revisionId, req.user.id, payload);

        return res.status(200).json({
            success: true,
            message: 'Revision updated successfully',
            data: { comment: revision }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/workspaces/:workspaceId/files/:fileId/revisions/:revisionId
 * Delete a revision.
 */
router.delete('/files/:fileId/revisions/:revisionId', async (req, res, next) => {
    try {
        const { workspaceId, fileId, revisionId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        await deleteFileRevisionService(workspaceId, fileId, revisionId, req.user.id);

        return res.status(200).json({
            success: true,
            message: 'Revision deleted successfully',
            data: null
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/workspaces/:workspaceId/files/:fileId/permissions
 * Share file with specified team members.
 */
router.patch('/files/:fileId/permissions', validate(updatePermissionsSchema), async (req, res, next) => {
    try {
        const { workspaceId, fileId } = req.validated.params;
        const { visibleTo } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const updatedPermissions = await updateFilePermissionsService(workspaceId, fileId, visibleTo);

        return res.status(200).json({
            success: true,
            message: 'File permissions updated successfully',
            data: { visibleTo: updatedPermissions }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
