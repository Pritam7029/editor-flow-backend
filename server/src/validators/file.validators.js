const { z } = require('zod');

const initUploadSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        name: z.string().trim().min(1, 'File name is required'),
        size_bytes: z.number().int().nonnegative().max(1024 * 1024 * 1024 * 5, 'File size cannot exceed 5GB'), // 5GB limit
        mime_type: z.string().trim().min(1, 'MIME type is required')
    }),
    query: z.any().optional()
});

const completeUploadSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        fileId: z.string().uuid('Invalid file ID'),
        versionId: z.string().uuid('Invalid version ID'),
        durationSeconds: z.number().nonnegative().nullable().optional()
    }),
    query: z.any().optional()
});

const createFileVersionSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID'),
        fileId: z.string().uuid('Invalid file ID')
    }),
    body: z.object({
        name: z.string().trim().min(1, 'File name is required'),
        size_bytes: z.number().int().nonnegative().max(1024 * 1024 * 1024 * 5, 'File size cannot exceed 5GB'),
        mime_type: z.string().trim().min(1, 'MIME type is required')
    }),
    query: z.any().optional()
});

const createFileRevisionSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID'),
        fileId: z.string().uuid('Invalid file ID')
    }),
    body: z.object({
        fileVersionId: z.string().uuid('Invalid file version ID'),
        timestampSeconds: z.number().nonnegative('Timestamp must be non-negative'),
        body: z.string().trim().min(1, 'Revision body cannot be empty'),
        priority: z.enum(['low', 'normal', 'high']).optional()
    }),
    query: z.any().optional()
});

const updateFileRevisionSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID'),
        fileId: z.string().uuid('Invalid file ID'),
        revisionId: z.string().uuid('Invalid revision ID')
    }),
    body: z.object({
        body: z.string().trim().min(1, 'Revision body cannot be empty').optional(),
        priority: z.enum(['low', 'normal', 'high']).optional(),
        status: z.enum(['open', 'resolved']).optional()
    }),
    query: z.any().optional()
});

const updatePermissionsSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID'),
        fileId: z.string().uuid('Invalid file ID')
    }),
    body: z.object({
        visibleTo: z.array(z.string().uuid()).nullable().optional()
    }),
    query: z.any().optional()
});

module.exports = {
    initUploadSchema,
    completeUploadSchema,
    createFileVersionSchema,
    createFileRevisionSchema,
    updateFileRevisionSchema,
    updatePermissionsSchema
};
