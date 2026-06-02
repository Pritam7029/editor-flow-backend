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
    clearChatSchema
} = require('../validators/chat.validators');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/**
 * GET /api/workspaces/:workspaceId/chat
 * Fetch and structure all chat teams and messages for the workspace
 */
router.get('/chat', async (req, res, next) => {
    try {
        const { workspaceId } = req.params;

        // Verify membership access
        await requireWorkspaceMember(req.user.id, workspaceId);

        // 1. Fetch all teams in the workspace (including member mappings)
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

        // 2. Fetch all messages in the workspace hydrated with sender profile info
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
            .order('created_at', { ascending: true });

        if (messagesError) throw messagesError;

        // 3. Structure the final chat data tree to match frontend expectation
        const globalChat = { general: [], links: [], feedback: [] };
        const dmChat = {};
        const teamsChat = {};

        // Initialize teams
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

        // Distribute messages to global channels, DMs, or Teams
        (messages || []).forEach(msg => {
            const channel = msg.channel; // 'general', 'links', or 'feedback'
            
            // Safety check for invalid channels in DB
            if (!globalChat[channel] && channel !== 'tagged') {
                return;
            }

            const formattedMessage = {
                id: msg.id,
                senderId: msg.sender_id,
                senderName: msg.sender?.full_name || msg.sender?.email?.split('@')[0] || 'Unknown',
                text: msg.text,
                ts: new Date(msg.created_at).getTime()
            };

            if (msg.conv_type === 'global') {
                globalChat[channel].push(formattedMessage);
            } else if (msg.conv_type === 'dm') {
                // DM is mapped under the *other* collaborator's profile ID in local state
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
 * POST /api/workspaces/:workspaceId/chat/messages
 * Send a chat message
 */
router.post('/chat/messages', validate(sendMessageSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { text, channel, convType, recipientId, teamId } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        // Save to Database
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

        // Fetch sender's current profile details
        const { data: sender, error: senderError } = await supabaseAdmin
            .from('profiles')
            .select('full_name, email')
            .eq('id', req.user.id)
            .single();

        if (senderError) throw senderError;

        const hydratedMessage = {
            id: newMsg.id,
            senderId: newMsg.sender_id,
            senderName: sender.full_name || sender.email || 'Unknown',
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
 * POST /api/workspaces/:workspaceId/chat/teams
 * Create a new team/group channel in workspace
 */
router.post('/chat/teams', validate(createTeamSchema), async (req, res, next) => {
    try {
        const { workspaceId } = req.validated.params;
        const { name, memberIds } = req.validated.body;

        await requireWorkspaceMember(req.user.id, workspaceId);

        // 1. Insert team
        const { data: team, error: teamError } = await supabaseAdmin
            .from('chat_teams')
            .insert({
                workspace_id: workspaceId,
                name
            })
            .select()
            .single();

        if (teamError) throw teamError;

        // 2. Insert team members
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
 * POST /api/workspaces/:workspaceId/chat/clear
 * Clear the chat logs for the active conversation target
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
            // Clear message logs between current user and target user
            deleteQuery = deleteQuery.or(`and(sender_id.eq.${req.user.id},recipient_id.eq.${targetId}),and(sender_id.eq.${targetId},recipient_id.eq.${req.user.id})`);
        } else if (convType === 'team') {
            if (!targetId) {
                return res.status(400).json({ success: false, message: 'Team ID is required to clear Team chats' });
            }
            deleteQuery = deleteQuery.eq('team_id', targetId);
        } else {
            // Global: Clear all global channel messages
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

module.exports = router;
