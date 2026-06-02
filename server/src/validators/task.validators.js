const { z } = require('zod');

const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

const createColumnSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid()
    }),
    body: z.object({
        key: z
            .string()
            .trim()
            .min(2, 'Column key must be at least 2 characters')
            .max(30, 'Column key must be at most 30 characters')
            .regex(/^[a-zA-Z0-9_]+$/, 'Column key can only contain alphanumeric characters and underscores'),
        label: z
            .string()
            .trim()
            .min(1, 'Column label cannot be empty')
            .max(50, 'Column label must be at most 50 characters'),
        emoji: z.string().trim().max(10).default('📌'),
        color: z.string().regex(HEX_COLOR_REGEX, 'Invalid hex color code').default('#8b5cf6'),
        position: z.number().int().nonnegative().optional()
    }),
    query: z.any().optional()
});

const updateColumnSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid(),
        columnId: z.string().uuid()
    }),
    body: z.object({
        label: z.string().trim().min(1, 'Column label cannot be empty').max(50).optional(),
        emoji: z.string().trim().max(10).optional(),
        color: z.string().regex(HEX_COLOR_REGEX, 'Invalid hex color code').optional(),
        position: z.number().int().nonnegative().optional()
    }),
    query: z.any().optional()
});

const reorderColumnsSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid()
    }),
    body: z.object({
        keys: z.array(z.string()).min(1, 'Keys array cannot be empty')
    }),
    query: z.any().optional()
});

const createTaskSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid()
    }),
    body: z.object({
        title: z
            .string()
            .trim()
            .min(1, 'Task title cannot be empty')
            .max(120, 'Task title must be at most 120 characters'),
        description: z.string().trim().optional(),
        type: z.string().trim().default('other'),
        priority: z.enum(['low', 'medium', 'high']).default('medium'),
        status: z.string().trim().min(1, 'Task status/column key is required'),
        assigneeId: z.string().uuid().or(z.literal('')).nullable().optional(),
        deadline: z.string().datetime({ precision: 3 }).or(z.string().date()).or(z.literal('')).nullable().optional(),
        position: z.number().int().nonnegative().default(0)
    }),
    query: z.any().optional()
});

const updateTaskSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid(),
        taskId: z.string().uuid()
    }),
    body: z.object({
        title: z.string().trim().min(1, 'Task title cannot be empty').max(120).optional(),
        description: z.string().trim().nullable().optional(),
        type: z.string().trim().optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        status: z.string().trim().min(1).optional(),
        assigneeId: z.string().uuid().or(z.literal('')).nullable().optional(),
        deadline: z.string().datetime({ precision: 3 }).or(z.string().date()).or(z.literal('')).nullable().optional(),
        position: z.number().int().nonnegative().optional()
    }),
    query: z.any().optional()
});

const createCommentSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid(),
        taskId: z.string().uuid()
    }),
    body: z.object({
        text: z.string().trim().min(1, 'Comment text cannot be empty')
    }),
    query: z.any().optional()
});

module.exports = {
    createColumnSchema,
    updateColumnSchema,
    reorderColumnsSchema,
    createTaskSchema,
    updateTaskSchema,
    createCommentSchema
};
