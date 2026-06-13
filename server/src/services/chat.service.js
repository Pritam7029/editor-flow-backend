const { supabaseAdmin } = require('../config/supabase');

async function getOrCreateWorkspaceGeneralThread(workspaceId, creatorId) {
    // Check if a workspace-wide general thread already exists
    const { data: threads, error: threadError } = await supabaseAdmin
        .from('chat_threads')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('type', 'workspace')
        .limit(1);

    if (threadError) throw threadError;

    if (threads && threads.length > 0) {
        return threads[0];
    }

    // Create the default thread
    const { data: newThread, error: insertError } = await supabaseAdmin
        .from('chat_threads')
        .insert({
            workspace_id: workspaceId,
            type: 'workspace',
            encrypted_name: null, // "General" is implied by type
            created_by: creatorId
        })
        .select()
        .single();

    if (insertError) throw insertError;

    // Add creator as member
    const { error: memberError } = await supabaseAdmin
        .from('chat_thread_members')
        .insert({
            thread_id: newThread.id,
            user_id: creatorId,
            role: 'admin'
        });

    if (memberError) throw memberError;

    return newThread;
}

async function getWorkspaceThreads(workspaceId, userId) {
    // Ensure default general thread exists
    await getOrCreateWorkspaceGeneralThread(workspaceId, userId);

    // Fetch all threads that are type 'workspace' OR where user is a member
    const { data: threads, error: fetchError } = await supabaseAdmin
        .from('chat_threads')
        .select(`
            *,
            chat_thread_members (
                user_id,
                role
            )
        `)
        .eq('workspace_id', workspaceId);

    if (fetchError) throw fetchError;

    // Filter threads user has access to
    const accessibleThreads = (threads || []).filter(thread => {
        if (thread.type === 'workspace') return true;
        const members = thread.chat_thread_members || [];
        return members.some(m => m.user_id === userId);
    });

    return accessibleThreads;
}

async function createChatThread(workspaceId, { type, encryptedName, nameIv, createdBy, memberIds }) {
    // Insert thread
    const { data: thread, error: threadError } = await supabaseAdmin
        .from('chat_threads')
        .insert({
            workspace_id: workspaceId,
            type: type || 'workspace',
            encrypted_name: encryptedName,
            name_iv: nameIv,
            created_by: createdBy
        })
        .select()
        .single();

    if (threadError) throw threadError;

    // Construct members list (ensuring creator is included)
    const uniqueMembers = new Set(memberIds || []);
    uniqueMembers.add(createdBy);

    const memberRows = Array.from(uniqueMembers).map(userId => ({
        thread_id: thread.id,
        user_id: userId,
        role: userId === createdBy ? 'admin' : 'member'
    }));

    const { error: membersError } = await supabaseAdmin
        .from('chat_thread_members')
        .insert(memberRows);

    if (membersError) throw membersError;

    return {
        ...thread,
        memberIds: Array.from(uniqueMembers),
        chat_thread_members: memberRows.map(row => ({
            user_id: row.user_id,
            role: row.role
        }))
    };
}

async function verifyThreadAccess(threadId, userId) {
    const { data: thread, error: threadError } = await supabaseAdmin
        .from('chat_threads')
        .select('*')
        .eq('id', threadId)
        .maybeSingle();

    if (threadError || !thread) {
        throw new Error('Thread not found or inaccessible');
    }

    if (thread.type === 'workspace') {
        // Workspace threads require workspace membership
        const { data: member, error: memberError } = await supabaseAdmin
            .from('workspace_members')
            .select('*')
            .eq('workspace_id', thread.workspace_id)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();

        if (memberError || !member) {
            throw new Error('Access denied to workspace thread');
        }
    } else {
        // Other threads require thread membership
        const { data: member, error: memberError } = await supabaseAdmin
            .from('chat_thread_members')
            .select('*')
            .eq('thread_id', threadId)
            .eq('user_id', userId)
            .maybeSingle();

        if (memberError || !member) {
            throw new Error('Access denied to private thread');
        }
    }

    return thread;
}

async function getThreadMessages(workspaceId, threadId, userId) {
    // Verify access
    await verifyThreadAccess(threadId, userId);

    const { data: messages, error: messagesError } = await supabaseAdmin
        .from('chat_messages')
        .select(`
            *,
            sender:profiles!sender_id (
                full_name,
                email
            )
        `)
        .eq('workspace_id', workspaceId)
        .eq('thread_id', threadId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    return (messages || []).map(msg => ({
        id: msg.id,
        threadId: msg.thread_id,
        senderId: msg.sender_id,
        senderName: (msg.sender && msg.sender.full_name) || (msg.sender && msg.sender.email && msg.sender.email.split('@')[0]) || 'Unknown',
        encryptedBody: msg.encrypted_body,
        bodyIv: msg.body_iv,
        encryptionAlgorithm: msg.encryption_algorithm,
        workspaceKeyId: msg.workspace_key_id,
        senderDeviceKeyId: msg.sender_device_key_id,
        clientMessageId: msg.client_message_id,
        messageType: msg.message_type,
        ts: new Date(msg.created_at).getTime()
    }));
}

async function saveMessage(workspaceId, threadId, userId, messageData) {
    // Verify access
    const thread = await verifyThreadAccess(threadId, userId);

    const {
        encryptedBody,
        bodyIv,
        encryptionAlgorithm,
        workspaceKeyId,
        senderDeviceKeyId,
        clientMessageId,
        messageType
    } = messageData;

    let convType = 'global';
    if (thread.type === 'dm') {
        convType = 'dm';
    } else if (thread.type === 'group') {
        convType = 'team';
    }

    const { data: newMsg, error: insertError } = await supabaseAdmin
        .from('chat_messages')
        .insert({
            workspace_id: workspaceId,
            thread_id: threadId,
            sender_id: userId,
            sender_device_key_id: senderDeviceKeyId,
            workspace_key_id: workspaceKeyId,
            encrypted_body: encryptedBody,
            body_iv: bodyIv,
            encryption_algorithm: encryptionAlgorithm || 'AES-GCM',
            message_type: messageType || 'text',
            client_message_id: clientMessageId || null,
            channel: 'general',
            conv_type: convType
        })
        .select()
        .single();

    if (insertError) throw insertError;

    // Get sender info
    const { data: sender, error: senderError } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('id', userId)
        .single();

    if (senderError) throw senderError;

    return {
        id: newMsg.id,
        threadId: newMsg.thread_id,
        senderId: newMsg.sender_id,
        senderName: (sender && sender.full_name) || (sender && sender.email && sender.email.split('@')[0]) || 'Unknown',
        encryptedBody: newMsg.encrypted_body,
        bodyIv: newMsg.body_iv,
        encryptionAlgorithm: newMsg.encryption_algorithm,
        workspaceKeyId: newMsg.workspace_key_id,
        senderDeviceKeyId: newMsg.sender_device_key_id,
        clientMessageId: newMsg.client_message_id,
        messageType: newMsg.message_type,
        ts: new Date(newMsg.created_at).getTime()
    };
}

async function deleteMessage(workspaceId, messageId, userId) {
    const { data: message, error: selectError } = await supabaseAdmin
        .from('chat_messages')
        .select('*')
        .eq('id', messageId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

    if (selectError || !message) {
        throw new Error('Message not found');
    }

    if (message.sender_id !== userId) {
        throw new Error('You can only delete your own messages');
    }

    const { error: deleteError } = await supabaseAdmin
        .from('chat_messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', messageId);

    if (deleteError) throw deleteError;
    return { id: messageId, threadId: message.thread_id };
}

module.exports = {
    getWorkspaceThreads,
    createChatThread,
    verifyThreadAccess,
    getThreadMessages,
    saveMessage,
    deleteMessage
};
