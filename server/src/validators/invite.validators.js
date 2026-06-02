const { z } = require('zod');

const createInviteSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid()
    }),
    body: z.object({
        email: z.string().trim().email('Please enter a valid email address'),
        role: z.enum(['admin', 'editor', 'viewer']).default('editor')
    }),
    query: z.any().optional()
});

const resolveInviteSchema = z.object({
    params: z.object({
        token: z.string().min(10, 'Invalid token format')
    }),
    body: z.any().optional(),
    query: z.any().optional()
});

const acceptInviteSchema = z.object({
    params: z.object({
        token: z.string().min(10, 'Invalid token format')
    }),
    body: z.any().optional(),
    query: z.any().optional()
});

const updateMemberSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid(),
        memberId: z.string().uuid()
    }),
    body: z.object({
        role: z.enum(['admin', 'editor', 'viewer'])
    }),
    query: z.any().optional()
});

const removeMemberSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid(),
        memberId: z.string().uuid()
    }),
    body: z.any().optional(),
    query: z.any().optional()
});

module.exports = {
    createInviteSchema,
    resolveInviteSchema,
    acceptInviteSchema,
    updateMemberSchema,
    removeMemberSchema
};
