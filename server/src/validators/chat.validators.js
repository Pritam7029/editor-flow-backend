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

// E2EE validators
const createThreadSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        type: z.enum(['workspace', 'group', 'dm', 'task', 'file']).default('workspace'),
        encryptedName: z.string().trim().optional().nullable(),
        nameIv: z.string().trim().optional().nullable(),
        memberIds: z.array(z.string().uuid('Invalid member ID')).optional()
    }),
    query: z.any().optional()
});

const sendE2EEMessageSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID'),
        threadId: z.string().uuid('Invalid thread ID')
    }),
    body: z.object({
        encryptedBody: z.string().min(1, 'Encrypted body is required'),
        bodyIv: z.string().min(1, 'Body IV is required'),
        encryptionAlgorithm: z.string().default('AES-GCM'),
        workspaceKeyId: z.string().uuid('Invalid workspace key ID'),
        clientMessageId: z.string().optional().nullable(),
        messageType: z.string().default('text')
    }),
    query: z.any().optional()
});

const createWorkspaceKeyGrantSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        keyVersion: z.number().int().min(1, 'Key version must be a positive integer'),
        keyAlgorithm: z.string().default('AES-GCM'),
        recipientUserId: z.string().uuid('Invalid recipient user ID'),
        encryptedWorkspaceKey: z.string().min(1, 'Encrypted workspace key is required'),
        grantAlgorithm: z.string().default('RSA-OAEP')
    }),
    query: z.any().optional()
});

const rotateWorkspaceKeySchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        newVersion: z.number().int().min(1, 'New key version must be a positive integer'),
        algorithm: z.string().default('AES-GCM'),
        grants: z.array(z.object({
            recipientUserId: z.string().uuid('Invalid recipient user ID'),
            encryptedWorkspaceKey: z.string().min(1, 'Encrypted workspace key is required'),
            grantAlgorithm: z.string().default('RSA-OAEP')
        })).min(1, 'At least one grant is required for key rotation')
    }),
    query: z.any().optional()
});

module.exports = {
    sendMessageSchema,
    createTeamSchema,
    clearChatSchema,
    createThreadSchema,
    sendE2EEMessageSchema,
    createWorkspaceKeyGrantSchema,
    rotateWorkspaceKeySchema
};

