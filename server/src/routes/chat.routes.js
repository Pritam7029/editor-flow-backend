const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const validate = require('../validators/validate');

const {
    requireWorkspaceMember
} = require('../services/workspaceAccess.service');

const {
    sendMessageSchema,
    createTeamSchema,
    clearChatSchema,
    createThreadSchema,
    sendE2EEMessageSchema,
    createWorkspaceKeyGrantSchema,
    rotateWorkspaceKeySchema
} = require('../validators/chat.validators');

const {
    getWorkspaceThreads,
    createChatThread,
    getThreadMessages,
    saveMessage,
    deleteMessage
} = require('../services/chat.service');

const {
    getWorkspaceKeyGrants,
    createWorkspaceKeyGrant,
    getMyWorkspaceKeyGrant,
    rotateWorkspaceKey,
    getWorkspaceMemberEncryptionIdentities
} = require('../services/workspaceKey.service');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/**
 * GET /api/workspaces/:workspaceId/chat
 * Fetch and structure all chat teams and messages for the workspace (Legacy)
 */
router.get('/chat', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;
        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: teams, error: teamsError } = await supabaseAdmin
            .from('chat_teams')
            .select(`
                id,
                name,
                created_at,
                chat_team_members (
                    member_id
                )
            `)
            .eq('workspace_id', workspaceId);

        if (teamsError) throw teamsError;

        const { data: messages, error: messagesError } = await supabaseAdmin
            .from('chat_messages')
            .select(`
                id,
                sender_id,
                text,
                channel,
                conv_type,
                recipient_id,
                team_id,
                created_at,
                sender:profiles!sender_id (
                    full_name,
                    email
                )
            `)
            .eq('workspace_id', workspaceId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (messagesError) throw messagesError;

        const globalChat = { general: [], links: [], feedback: [] };
        const dmChat = {};
        const teamsChat = {};

        (teams || []).forEach(team => {
            teamsChat[team.id] = {
                id: team.id,
                name: team.name,
                memberIds: (team.chat_team_members || []).map(m => m.member_id),
                general: [],
                links: [],
                feedback: []
            };
        });

        (messages || []).forEach(msg => {
            const channel = msg.channel;
            
            if (!globalChat[channel] && channel !== 'tagged') {
                return;
            }

            const formattedMessage = {
                id: msg.id,
                senderId: msg.sender_id,
                senderName: (msg.sender && msg.sender.full_name) || (msg.sender && msg.sender.email && msg.sender.email.split('@')[0]) || 'Unknown',
                text: msg.text,
                ts: new Date(msg.created_at).getTime()
            };

            if (msg.conv_type === 'global') {
                globalChat[channel].push(formattedMessage);
            } else if (msg.conv_type === 'dm') {
                const otherUserId = msg.sender_id === req.user.id ? msg.recipient_id : msg.sender_id;
                if (otherUserId) {
                    dmChat[otherUserId] = dmChat[otherUserId] || { general: [], links: [], feedback: [] };
                    if (dmChat[otherUserId][channel]) {
                        dmChat[otherUserId][channel].push(formattedMessage);
                    }
                }
            } else if (msg.conv_type === 'team') {
                const teamId = msg.team_id;
                if (teamId && teamsChat[teamId]) {
                    teamsChat[teamId][channel] = teamsChat[teamId][channel] || [];
                    teamsChat[teamId][channel].push(formattedMessage);
                }
            }
        });

        return res.status(200).json({
            success: true,
            message: 'Workspace chat data structured and fetched successfully',
            data: {
                chat: {
                    global: globalChat,
                    dm: dmChat,
                    teams: teamsChat
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/chat/messages (Legacy)
 */
router.post('/chat/messages', validate(sendMessageSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { text, channel, convType, recipientId, teamId } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: newMsg, error: insertError } = await supabaseAdmin
            .from('chat_messages')
            .insert({
                workspace_id: workspaceId,
                sender_id: req.user.id,
                text,
                channel,
                conv_type: convType,
                recipient_id: recipientId || null,
                team_id: teamId || null
            })
            .select()
            .single();

        if (insertError) throw insertError;

        const { data: sender, error: senderError } = await supabaseAdmin
            .from('profiles')
            .select('full_name, email')
            .eq('id', req.user.id)
            .single();

        if (senderError) throw senderError;

        const hydratedMessage = {
            id: newMsg.id,
            senderId: newMsg.sender_id,
            senderName: (sender && sender.full_name) || (sender && sender.email) || 'Unknown',
            text: newMsg.text,
            ts: new Date(newMsg.created_at).getTime()
        };

        return res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: { message: hydratedMessage }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/chat/teams (Legacy)
 */
router.post('/chat/teams', validate(createTeamSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { name, memberIds } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: team, error: teamError } = await supabaseAdmin
            .from('chat_teams')
            .insert({
                workspace_id: workspaceId,
                name
            })
            .select()
            .single();

        if (teamError) throw teamError;

        const teamMembers = memberIds.map(mId => ({
            team_id: team.id,
            member_id: mId
        }));

        const { error: membersError } = await supabaseAdmin
            .from('chat_team_members')
            .insert(teamMembers);

        if (membersError) throw membersError;

        const structuredTeam = {
            id: team.id,
            name: team.name,
            memberIds,
            general: [],
            links: [],
            feedback: []
        };

        return res.status(201).json({
            success: true,
            message: 'Team channel created successfully',
            data: { team: structuredTeam }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/chat/clear (Legacy)
 */
router.post('/chat/clear', validate(clearChatSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { convType, targetId } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        let deleteQuery = supabaseAdmin
            .from('chat_messages')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('conv_type', convType);

        if (convType === 'dm') {
            if (!targetId) {
                return res.status(400).json({ success: false, message: 'Recipient ID is required to clear DMs' });
            }
            deleteQuery = deleteQuery.or(`and(sender_id.eq.${req.user.id},recipient_id.eq.${targetId}),and(sender_id.eq.${targetId},recipient_id.eq.${req.user.id})`);
        } else if (convType === 'team') {
            if (!targetId) {
                return res.status(400).json({ success: false, message: 'Team ID is required to clear Team chats' });
            }
            deleteQuery = deleteQuery.eq('team_id', targetId);
        } else {
            deleteQuery = deleteQuery.is('recipient_id', null).is('team_id', null);
        }

        const { error } = await deleteQuery;

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Chat cleared successfully',
            data: null
        });
    } catch (error) {
        next(error);
    }
});


// ==========================================
// E2EE Threads & Messages routes
// ==========================================

/**
 * GET /api/workspaces/:workspaceId/chat/threads
 * List all chat threads user has access to
 */
router.get('/chat/threads', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;
        await requireWorkspaceMember(req.user.id, workspaceId);

        const threads = await getWorkspaceThreads(workspaceId, req.user.id);
        return res.status(200).json({
            success: true,
            data: { threads }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/chat/threads
 * Create a new chat thread (private group, DM, etc.)
 */
router.post('/chat/threads', validate(createThreadSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { type, encryptedName, nameIv, memberIds } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const thread = await createChatThread(workspaceId, {
            type,
            encryptedName,
            nameIv,
            createdBy: req.user.id,
            memberIds
        });

        return res.status(201).json({
            success: true,
            message: 'Chat thread created successfully',
            data: { thread }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/chat/threads/:threadId/messages
 * Retrieve messages for a specific chat thread
 */
router.get('/chat/threads/:threadId/messages', async (req, res, next) => {
    try {
        const { workspaceId, threadId } = req.params;
        await requireWorkspaceMember(req.user.id, workspaceId);

        const messages = await getThreadMessages(workspaceId, threadId, req.user.id);
        return res.status(200).json({
            success: true,
            data: { messages }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/chat/threads/:threadId/messages
 * Send an E2EE chat message to a thread
 */
router.post('/chat/threads/:threadId/messages', validate(sendE2EEMessageSchema), async (req, res, next) => {
    try {
        const { workspaceId, threadId } = req.validated.params;
        
        await requireWorkspaceMember(req.user.id, workspaceId);

        const message = await saveMessage(workspaceId, threadId, req.user.id, req.validated.body);

        // Realtime emission helper: We trigger the Socket.IO broadcast via local event emitter or global app instance
        if (req.app.get('socketio')) {
            const io = req.app.get('socketio');
            io.to(`thread:${threadId}`).emit('chat:new-message', { message });
        }

        return res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: { message }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/workspaces/:workspaceId/chat/messages/:messageId
 * Soft delete a chat message
 */
router.delete('/chat/messages/:messageId', async (req, res, next) => {
    try {
        const { workspaceId, messageId } = req.params;
        await requireWorkspaceMember(req.user.id, workspaceId);

        const result = await deleteMessage(workspaceId, messageId, req.user.id);

        if (req.app.get('socketio')) {
            const io = req.app.get('socketio');
            io.to(`thread:${result.threadId}`).emit('chat:message-deleted', {
                messageId: result.id,
                threadId: result.threadId
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Message deleted successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
});


// ==========================================
// E2EE Workspace Encryption Key Grants routes
// ==========================================

/**
 * GET /api/workspaces/:workspaceId/encryption/status
 * Fetch active workspace encryption key metadata status
 */
router.get('/encryption/status', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;
        await requireWorkspaceMember(req.user.id, workspaceId);

        const { data: keyRow, error } = await supabaseAdmin
            .from('workspace_encryption_keys')
            .select('id, key_version, algorithm, status')
            .eq('workspace_id', workspaceId)
            .eq('status', 'active')
            .maybeSingle();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            data: {
                enabled: !!keyRow,
                workspaceKeyId: keyRow ? keyRow.id : null,
                keyVersion: keyRow ? keyRow.key_version : null,
                algorithm: keyRow ? keyRow.algorithm : null
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/encryption/initialize
 * Initialize workspace encryption key & create grant for owner/admin
 */
router.post('/encryption/initialize', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;
        const { keyAlgorithm, encryptedWorkspaceKey, grantAlgorithm } = req.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const grant = await createWorkspaceKeyGrant(workspaceId, {
            keyVersion: 1,
            keyAlgorithm: keyAlgorithm || 'AES-GCM',
            recipientUserId: req.user.id,
            encryptedWorkspaceKey,
            grantAlgorithm: grantAlgorithm || 'RSA-OAEP',
            grantedBy: req.user.id
        });

        return res.status(201).json({
            success: true,
            message: 'Workspace encryption initialized successfully',
            data: { grant }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/encryption/grants
 * Fetch all workspace key grants
 */
router.get('/encryption/grants', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;
        await requireWorkspaceMember(req.user.id, workspaceId);

        const grants = await getWorkspaceKeyGrants(workspaceId);
        return res.status(200).json({
            success: true,
            data: { grants }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/encryption/grants
 * Grant workspace key to user (user-level)
 */
router.post('/encryption/grants', validate(createWorkspaceKeyGrantSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { keyVersion, keyAlgorithm, recipientUserId, encryptedWorkspaceKey, grantAlgorithm } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const grant = await createWorkspaceKeyGrant(workspaceId, {
            keyVersion,
            keyAlgorithm,
            recipientUserId,
            encryptedWorkspaceKey,
            grantAlgorithm,
            grantedBy: req.user.id
        });

        return res.status(201).json({
            success: true,
            message: 'Workspace key grant created successfully',
            data: { grant }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/encryption/keys
 * Fetch active public keys/identities for all active workspace members
 */
router.get('/encryption/keys', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;
        await requireWorkspaceMember(req.user.id, workspaceId);

        const keys = await getWorkspaceMemberEncryptionIdentities(workspaceId);
        return res.status(200).json({
            success: true,
            data: { keys }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/workspaces/:workspaceId/encryption/my-grant
 * Fetch caller's grant (no device key required)
 */
router.get('/encryption/my-grant', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;
        await requireWorkspaceMember(req.user.id, workspaceId);

        const grant = await getMyWorkspaceKeyGrant(workspaceId, req.user.id);
        return res.status(200).json({
            success: true,
            data: { grant }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/workspaces/:workspaceId/encryption/rotate-key
 * Rotate workspace symmetric key
 */
router.post('/encryption/rotate-key', validate(rotateWorkspaceKeySchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { newVersion, algorithm, grants } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        const result = await rotateWorkspaceKey(workspaceId, {
            newVersion,
            algorithm,
            creatorId: req.user.id,
            grants
        });

        return res.status(200).json({
            success: true,
            message: 'Workspace encryption key rotated successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
