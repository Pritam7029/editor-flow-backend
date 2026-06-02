const { z } = require('zod');

const fileItemSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, 'File name is required'),
    type: z.string().trim().min(1, 'File type is required'),
    size: z.number().int().nonnegative().optional(),
    dataUrl: z.string().trim().nullable().optional(),
    visibleTo: z.array(z.string().uuid()).nullable().optional()
});

const createFilesSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        files: z.array(fileItemSchema).min(1, 'At least one file is required')
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

const createFileCommentSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID'),
        fileId: z.string().uuid('Invalid file ID')
    }),
    body: z.object({
        text: z.string().trim().min(1, 'Comment text is required'),
        timestamp: z.number().nonnegative().nullable().optional()
    }),
    query: z.any().optional()
});

module.exports = {
    createFilesSchema,
    updatePermissionsSchema,
    createFileCommentSchema
};
