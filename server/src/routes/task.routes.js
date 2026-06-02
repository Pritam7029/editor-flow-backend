const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const validate = require('../validators/validate');

const {
    requireWorkspaceMember
} = require('../services/workspaceAccess.service');

const {
    createColumnSchema,
    updateColumnSchema,
    reorderColumnsSchema,
    createTaskSchema,
    updateTaskSchema,
    createCommentSchema
} = require('../validators/task.validators');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/**
 * GET /api/workspaces/:workspaceId/columns
 * Get Kanban columns for workspace (auto-initializes defaults if empty)
 */
router.get('/columns', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: columns, error } = await supabaseAdmin
            .from('task_columns')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('position', { ascending: true });

        if (error) throw error;

        if (columns && columns.length > 0) {
            return res.status(200).json({
                success: true,
                message: 'Columns fetched successfully',
                data: { columns }
            });
        }

        // Auto-initialize standard columns for newly created workspaces
        const defaults = [
            { workspace_id: workspaceId, key: 'todo', label: 'To Do', emoji: '📋', color: '#94a3b8', position: 0 },
            { workspace_id: workspaceId, key: 'inprogress', label: 'In Progress', emoji: '⚡', color: '#f59e0b', position: 1 },
            { workspace_id: workspaceId, key: 'done', label: 'Done', emoji: '✅', color: '#10b981', position: 2 }
        ];

        const { data: insertedColumns, error: insertError } = await supabaseAdmin
            .from('task_columns')
            .insert(defaults)
            .select();

        if (insertError) throw insertError;

        return res.status(200).json({
            success: true,
            message: 'Default columns initialized successfully',
            data: { columns: insertedColumns }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/columns
 * Create custom column
 */
router.post('/columns', validate(createColumnSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { key, label, emoji, color, position } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        // Compute default position if not provided
        let colPosition = position;
        if (colPosition === undefined) {
            const { data: existingCols } = await supabaseAdmin
                .from('task_columns')
                .select('position')
                .eq('workspace_id', workspaceId)
                .order('position', { ascending: false })
                .limit(1);
            colPosition = existingCols && existingCols.length > 0 ? existingCols[0].position + 1 : 0;
        }

        const { data: column, error } = await supabaseAdmin
            .from('task_columns')
            .insert({
                workspace_id: workspaceId,
                key,
                label,
                emoji,
                color,
                position: colPosition
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            message: 'Column created successfully',
            data: { column }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/workspaces/:workspaceId/columns/:columnId
 * Update custom column
 */
router.patch('/columns/:columnId', validate(updateColumnSchema), async (req, res, next) => {
    try {
        const { workspaceId, columnId } = req.validated.params;
        const body = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: column, error } = await supabaseAdmin
            .from('task_columns')
            .update({
                ...body,
                updated_at: new Date()
            })
            .eq('id', columnId)
            .eq('workspace_id', workspaceId)
            .select()
            .single();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Column updated successfully',
            data: { column }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/workspaces/:workspaceId/columns/:columnId
 * Delete custom column
 */
router.delete('/columns/:columnId', async (req, res, next) => {
    try {
        const { workspaceId, columnId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { error } = await supabaseAdmin
            .from('task_columns')
            .delete()
            .eq('id', columnId)
            .eq('workspace_id', workspaceId);

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Column deleted successfully',
            data: null
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/workspaces/:workspaceId/columns/reorder
 * Reorder column positions
 */
router.patch('/columns/reorder', validate(reorderColumnsSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { keys } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        // Update each column position sequentially or in parallel
        await Promise.all(keys.map((key, index) => {
            return supabaseAdmin
                .from('task_columns')
                .update({ position: index, updated_at: new Date() })
                .eq('workspace_id', workspaceId)
                .eq('key', key);
        }));

        return res.status(200).json({
            success: true,
            message: 'Columns reordered successfully',
            data: null
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/tasks
 * Fetch all tasks (hydrated with comments & metadata)
 */
router.get('/tasks', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        // Fetch columns first to establish ID-to-Key mapping
        const { data: columns } = await supabaseAdmin
            .from('task_columns')
            .select('id, key')
            .eq('workspace_id', workspaceId);

        const columnKeyMap = new Map((columns || []).map(c => [c.id, c.key]));

        // Fetch workspace members to map assignee_id (workspace_members.id) to user_id (profile/editor id)
        const { data: members } = await supabaseAdmin
            .from('workspace_members')
            .select('id, user_id')
            .eq('workspace_id', workspaceId);

        const memberUserMap = new Map((members || []).map(m => [m.id, m.user_id]));

        // Fetch tasks
        const { data: tasks, error: tasksError } = await supabaseAdmin
            .from('tasks')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('position', { ascending: true });

        if (tasksError) throw tasksError;

        // Fetch comments
        const { data: comments, error: commentsError } = await supabaseAdmin
            .from('task_comments')
            .select(`
                id,
                task_id,
                author_id,
                text,
                created_at,
                author:profiles (
                    full_name,
                    email
                )
            `)
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: true });

        if (commentsError) throw commentsError;

        const commentsByTaskId = {};
        (comments || []).forEach(c => {
            const taskId = c.task_id;
            commentsByTaskId[taskId] = commentsByTaskId[taskId] || [];
            commentsByTaskId[taskId].push({
                id: c.id,
                authorId: c.author_id,
                authorName: c.author?.full_name || c.author?.email || 'Unknown',
                text: c.text,
                ts: new Date(c.created_at).getTime()
            });
        });

        const hydratedTasks = (tasks || []).map(task => ({
            id: task.id,
            workspace_id: task.workspace_id,
            column_id: task.column_id,
            title: task.title,
            description: task.description || '',
            type: task.type,
            priority: task.priority,
            assigneeId: task.assignee_id ? (memberUserMap.get(task.assignee_id) || '') : '',
            created_by: task.created_by,
            deadline: task.deadline || '',
            status: task.column_id ? (columnKeyMap.get(task.column_id) || 'todo') : 'todo',
            position: task.position,
            comments: commentsByTaskId[task.id] || [],
            created_at: task.created_at,
            updated_at: task.updated_at
        }));

        return res.status(200).json({
            success: true,
            message: 'Tasks fetched successfully',
            data: { tasks: hydratedTasks }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/tasks
 * Create a new task
 */
router.post('/tasks', validate(createTaskSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { title, description, type, priority, status, assigneeId, deadline, position } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        // Fetch corresponding column ID
        const { data: column, error: colError } = await supabaseAdmin
            .from('task_columns')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('key', status)
            .single();

        if (colError || !column) {
            return res.status(400).json({
                success: false,
                message: `Task column matching key "${status}" was not found`
            });
        }

        // Translate user-facing assigneeId (user profile ID) to internal workspace_members.id
        let dbAssigneeId = null;
        if (assigneeId) {
            const { data: member } = await supabaseAdmin
                .from('workspace_members')
                .select('id')
                .eq('workspace_id', workspaceId)
                .eq('user_id', assigneeId)
                .eq('status', 'active')
                .maybeSingle();
            
            if (member) {
                dbAssigneeId = member.id;
            }
        }

        const { data: task, error: insertError } = await supabaseAdmin
            .from('tasks')
            .insert({
                workspace_id: workspaceId,
                column_id: column.id,
                title,
                description,
                type,
                priority,
                assignee_id: dbAssigneeId,
                created_by: req.user.id,
                deadline: deadline || null,
                position
            })
            .select()
            .single();

        if (insertError) throw insertError;

        // Hydrate empty comments array for immediate state use
        const hydratedTask = {
            ...task,
            assigneeId: assigneeId || '',
            deadline: task.deadline || '',
            status,
            comments: []
        };

        return res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: { task: hydratedTask }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/workspaces/:workspaceId/tasks/:taskId
 * Update task details (can also move column or change order)
 */
router.patch('/tasks/:taskId', validate(updateTaskSchema), async (req, res, next) => {
    try {
        const { workspaceId, taskId } = req.validated.params;
        const { title, description, type, priority, status, assigneeId, deadline, position } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (type !== undefined) updates.type = type;
        if (priority !== undefined) updates.priority = priority;
        if (position !== undefined) updates.position = position;
        
        if (assigneeId !== undefined) {
            if (assigneeId) {
                const { data: member } = await supabaseAdmin
                    .from('workspace_members')
                    .select('id')
                    .eq('workspace_id', workspaceId)
                    .eq('user_id', assigneeId)
                    .eq('status', 'active')
                    .maybeSingle();
                
                updates.assignee_id = member ? member.id : null;
            } else {
                updates.assignee_id = null;
            }
        }
        
        if (deadline !== undefined) {
            updates.deadline = deadline || null;
        }

        // Retrieve column ID if moving columns
        if (status !== undefined) {
            const { data: column, error: colError } = await supabaseAdmin
                .from('task_columns')
                .select('id')
                .eq('workspace_id', workspaceId)
                .eq('key', status)
                .single();

            if (colError || !column) {
                return res.status(400).json({
                    success: false,
                    message: `Target column key "${status}" not found`
                });
            }
            updates.column_id = column.id;
        }

        const { data: task, error: updateError } = await supabaseAdmin
            .from('tasks')
            .update({
                ...updates,
                updated_at: new Date()
            })
            .eq('id', taskId)
            .eq('workspace_id', workspaceId)
            .select()
            .single();

        if (updateError) throw updateError;

        let returnAssigneeId = '';
        if (assigneeId !== undefined) {
            returnAssigneeId = assigneeId || '';
        } else if (task.assignee_id) {
            const { data: member } = await supabaseAdmin
                .from('workspace_members')
                .select('user_id')
                .eq('id', task.assignee_id)
                .maybeSingle();
            returnAssigneeId = member ? (member.user_id || '') : '';
        }

        const hydratedTask = {
            ...task,
            assigneeId: returnAssigneeId,
            deadline: task.deadline || '',
            status: status !== undefined ? status : undefined
        };

        return res.status(200).json({
            success: true,
            message: 'Task updated successfully',
            data: { task: hydratedTask }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/workspaces/:workspaceId/tasks/:taskId
 * Delete task
 */
router.delete('/tasks/:taskId', async (req, res, next) => {
    try {
        const { workspaceId, taskId } = req.params;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { error } = await supabaseAdmin
            .from('tasks')
            .delete()
            .eq('id', taskId)
            .eq('workspace_id', workspaceId);

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Task deleted successfully',
            data: null
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/tasks/:taskId/comments
 * Add task comment
 */
router.post('/tasks/:taskId/comments', validate(createCommentSchema), async (req, res, next) => {
    try {
        const { workspaceId, taskId } = req.validated.params;
        const { text } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: comment, error: insertError } = await supabaseAdmin
            .from('task_comments')
            .insert({
                workspace_id: workspaceId,
                task_id: taskId,
                author_id: req.user.id,
                text
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
