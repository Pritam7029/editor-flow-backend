const { z } = require('zod');

const createNotificationSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID')
    }),
    body: z.object({
        icon: z.string().trim().min(1, 'Icon is required'),
        iconClass: z.string().trim().min(1, 'Icon class is required'),
        title: z.string().trim().min(1, 'Title is required'),
        sub: z.string().trim().min(1, 'Subtext is required'),
        targetEditorId: z.string().uuid('Invalid target editor ID').nullable().optional()
    }),
    query: z.any().optional()
});

const markReadSchema = z.object({
    params: z.object({
        workspaceId: z.string().uuid('Invalid workspace ID'),
        notificationId: z.string().uuid('Invalid notification ID')
    }),
    body: z.any().optional(),
    query: z.any().optional()
});

module.exports = {
    createNotificationSchema,
    markReadSchema
};
