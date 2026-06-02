const { z } = require('zod');

const sendMessageSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        text: z.string().trim().min(1, 'Message text is required'),
        channel: z.enum(['general', 'links', 'feedback'], {
            errorMap: () => ({ message: 'Invalid channel' })
        }),
        convType: z.enum(['global', 'dm', 'team'], {
            errorMap: () => ({ message: 'Invalid conversation type' })
        }),
        recipientId: z.string().uuid('Invalid recipient ID').nullable().optional(),
        teamId: z.string().uuid('Invalid team ID').nullable().optional()
    }),
    query: z.any().optional()
});

const createTeamSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        name: z.string().trim().min(1, 'Team name is required'),
        memberIds: z.array(z.string().uuid('Invalid member ID')).min(1, 'At least one team member is required')
    }),
    query: z.any().optional()
});

const clearChatSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        convType: z.enum(['global', 'dm', 'team'], {
            errorMap: () => ({ message: 'Invalid conversation type' })
        }),
        targetId: z.string().uuid('Invalid target ID').nullable().optional()
    }),
    query: z.any().optional()
});

module.exports = {
    sendMessageSchema,
    createTeamSchema,
    clearChatSchema
};
