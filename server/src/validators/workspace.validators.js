const { z } = require('zod');

const workspaceIdParamSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid()
    }),
    body: z.any().optional(),
    query: z.any().optional()
});

const createWorkspaceSchema = z.object({
    body: z.object({
        name: z
            .string()
            .trim()
            .min(2, 'Workspace name must be at least 2 characters')
            .max(80, 'Workspace name must be at most 80 characters')
    }),
    params: z.any().optional(),
    query: z.any().optional()
});

const updateWorkspaceSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid()
    }),
    body: z.object({
        name: z
            .string()
            .trim()
            .min(2, 'Workspace name must be at least 2 characters')
            .max(80, 'Workspace name must be at most 80 characters')
    }),
    query: z.any().optional()
});

module.exports = {
    workspaceIdParamSchema,
    createWorkspaceSchema,
    updateWorkspaceSchema
};