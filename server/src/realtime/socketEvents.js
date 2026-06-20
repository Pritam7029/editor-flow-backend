const { joinWorkspaceRoom, joinThreadRoom, leaveThreadRoom } = require('./socketRooms');
const { 
    setUserOnline, 
    setUserOffline, 
    getOnlineUsers, 
    setTypingState, 
    getTypingUsers 
} = require('./presence.service');

function registerSocketEvents(io, socket) {
    socket.on('workspace:join', async (payload, callback) => {
        const workspaceId = payload && payload.workspaceId;
        if (!workspaceId) {
            if (callback) callback({ success: false, error: 'workspaceId is required' });
            return;
        }

        const result = await joinWorkspaceRoom(socket, workspaceId);
        if (callback) callback(result);
        
        if (result && result.success) {
            socket.activeWorkspaceId = workspaceId;
            await setUserOnline(socket.user.id, workspaceId);
            
            const onlineUsers = await getOnlineUsers(workspaceId);
            io.to(`workspace:${workspaceId}`).emit('presence:update', {
                workspaceId,
                onlineUsers
            });
        }
    });

    socket.on('presence:heartbeat', async (payload) => {
        const workspaceId = payload && payload.workspaceId;
        if (workspaceId) {
            socket.activeWorkspaceId = workspaceId;
            await setUserOnline(socket.user.id, workspaceId);
            
            const onlineUsers = await getOnlineUsers(workspaceId);
            io.to(`workspace:${workspaceId}`).emit('presence:update', {
                workspaceId,
                onlineUsers
            });
        }
    });

    socket.on('chat:join-thread', async (payload, callback) => {
        const workspaceId = payload && payload.workspaceId;
        const threadId = payload && payload.threadId;
        if (!workspaceId || !threadId) {
            if (callback) callback({ success: false, error: 'workspaceId and threadId are required' });
            return;
        }

        const result = await joinThreadRoom(socket, workspaceId, threadId);
        if (callback) callback(result);
    });

    socket.on('chat:leave-thread', (payload) => {
        const threadId = payload && payload.threadId;
        if (threadId) {
            leaveThreadRoom(socket, threadId);
        }
    });

    socket.on('chat:typing-start', async (payload) => {
        const threadId = payload && payload.threadId;
        if (threadId) {
            await setTypingState(threadId, socket.user.id, true);
            const typingUsers = await getTypingUsers(threadId);
            io.to(`thread:${threadId}`).emit('chat:typing-update', {
                threadId,
                typingUsers
            });
        }
    });

    socket.on('chat:typing-stop', async (payload) => {
        const threadId = payload && payload.threadId;
        if (threadId) {
            await setTypingState(threadId, socket.user.id, false);
            const typingUsers = await getTypingUsers(threadId);
            io.to(`thread:${threadId}`).emit('chat:typing-update', {
                threadId,
                typingUsers
            });
        }
    });

    socket.on('disconnect', async () => {
        console.log(`Socket disconnected: ${socket.id}`);
        if (socket.activeWorkspaceId && socket.user) {
            const workspaceId = socket.activeWorkspaceId;
            await setUserOffline(socket.user.id, workspaceId);
            
            const onlineUsers = await getOnlineUsers(workspaceId);
            io.to(`workspace:${workspaceId}`).emit('presence:update', {
                workspaceId,
                onlineUsers
            });
        }
    });
}

module.exports = {
    registerSocketEvents
};
