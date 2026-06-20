const { supabaseAdmin } = require('../config/supabase');

/**
 * Automatically populates a newly created workspace with standard columns,
 * sample tasks assigned to the owner, a welcome chat message, and an onboarding notification.
 */
async function bootstrapWorkspaceDemoData(workspaceId, ownerId) {
    try {
        console.log(`Bootstrapping demo onboarding data for workspace ${workspaceId} and owner ${ownerId}...`);

        // 1. Check if default columns exist for the workspace, if not insert them
        const { data: existingColumns, error: colFetchError } = await supabaseAdmin
            .from('task_columns')
            .select('*')
            .eq('workspace_id', workspaceId);

        if (colFetchError) throw colFetchError;

        let todoColId, inprogressColId, doneColId;

        if (!existingColumns || existingColumns.length === 0) {
            const defaults = [
                { workspace_id: workspaceId, key: 'todo', label: 'To Do', emoji: '📋', color: '#94a3b8', position: 0 },
                { workspace_id: workspaceId, key: 'inprogress', label: 'In Progress', emoji: '⚡', color: '#f59e0b', position: 1 },
                { workspace_id: workspaceId, key: 'done', label: 'Done', emoji: '✅', color: '#10b981', position: 2 }
            ];

            const { data: insertedColumns, error: colError } = await supabaseAdmin
                .from('task_columns')
                .insert(defaults)
                .select();

            if (colError) throw colError;

            todoColId = insertedColumns.find(c => c.key === 'todo').id;
            inprogressColId = insertedColumns.find(c => c.key === 'inprogress').id;
            doneColId = insertedColumns.find(c => c.key === 'done').id;
        } else {
            todoColId = existingColumns.find(c => c.key === 'todo')?.id;
            inprogressColId = existingColumns.find(c => c.key === 'inprogress')?.id;
            doneColId = existingColumns.find(c => c.key === 'done')?.id;
        }

        // 2. Fetch the owner's workspace_member ID to assign tasks to
        const { data: ownerMember, error: memberError } = await supabaseAdmin
            .from('workspace_members')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('user_id', ownerId)
            .eq('status', 'active')
            .maybeSingle();

        if (memberError || !ownerMember) {
            throw memberError || new Error(`Owner member record not found in workspace_members for ownerId: ${ownerId}`);
        }

        const ownerMemberId = ownerMember.id;

        // 3. Seed sample tasks assigned to the owner themselves to get started
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

        const tasksToInsert = [
            {
                workspace_id: workspaceId,
                column_id: doneColId,
                title: 'Configure Workspace Boards',
                description: 'Set up custom workflow states and invite initial team leads.',
                type: 'design',
                priority: 'high',
                assignee_id: ownerMemberId,
                created_by: ownerId,
                deadline: threeDaysAgo,
                position: 0
            },
            {
                workspace_id: workspaceId,
                column_id: inprogressColId,
                title: 'Review Media Files & Add Annotations',
                description: 'Upload video review drafts to the Files review page and add timeline comment annotations for motion editors.',
                type: 'video',
                priority: 'medium',
                assignee_id: ownerMemberId,
                created_by: ownerId,
                deadline: tomorrow,
                position: 0
            },
            {
                workspace_id: workspaceId,
                column_id: todoColId,
                title: 'Invite Creative Collaborators',
                description: 'Use the members invite system to add video editors, copywriters, and color designers into the active space.',
                type: 'other',
                priority: 'low',
                assignee_id: ownerMemberId,
                created_by: ownerId,
                position: 0
            }
        ];

        const { error: tasksError } = await supabaseAdmin
            .from('tasks')
            .insert(tasksToInsert);

        if (tasksError) throw tasksError;

        // 4. Seed an initial general chat message in the global general channel
        const welcomeMessage = {
            workspace_id: workspaceId,
            sender_id: ownerId,
            text: "Welcome to EditorFlow! 🎉 I've pre-populated this workspace with a few onboarding tasks to help you get acclimated. Try dragging tasks across columns, uploading media files for timestamped feedback, or creating new channels in the chat panel!",
            channel: 'general',
            conv_type: 'global'
        };

        const { error: chatError } = await supabaseAdmin
            .from('chat_messages')
            .insert(welcomeMessage);

        if (chatError) throw chatError;

        // 5. Seed a persistent workspace notification to welcome the user
        const welcomeNotification = {
            workspace_id: workspaceId,
            recipient_id: ownerId,
            icon: '🎉',
            icon_class: 'mention-notif',
            title: 'Welcome to EditorFlow!',
            sub: 'Onboarding tasks and chat have been successfully bootstrapped.'
        };

        const { error: notifError } = await supabaseAdmin
            .from('workspace_notifications')
            .insert(welcomeNotification);

        if (notifError) throw notifError;

        console.log(`Demo onboarding data bootstrapped successfully for workspace ${workspaceId}!`);
        return true;
    } catch (err) {
        console.error('Failed to bootstrap demo data for workspace:', err);
        // Log the error but do not fail workspace creation to maintain server reliability
        return false;
    }
}

module.exports = {
    bootstrapWorkspaceDemoData
};
