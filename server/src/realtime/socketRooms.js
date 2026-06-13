const { requireWorkspaceMember } = require('../services/workspaceAccess.service');
const { verifyThreadAccess } = require('../services/chat.service');

async function joinWorkspaceRoom(socket, workspaceId) {
    try {
        await requireWorkspaceMember(socket.user.id, workspaceId);
        const roomName = `workspace:${workspaceId}`;
        socket.join(roomName);
        console.log(`Socket ${socket.id} joined workspace room: ${roomName}`);
        return { success: true };
    } catch (err) {
        console.error(`Socket join workspace room failed:`, err.message);
        return { success: false, error: err.message };
    }
}

async function joinThreadRoom(socket, workspaceId, threadId) {
    try {
        await requireWorkspaceMember(socket.user.id, workspaceId);
        await verifyThreadAccess(threadId, socket.user.id);
        const roomName = `thread:${threadId}`;
        socket.join(roomName);
        console.log(`Socket ${socket.id} joined thread room: ${roomName}`);
        return { success: true };
    } catch (err) {
        console.error(`Socket join thread room failed:`, err.message);
        return { success: false, error: err.message };
    }
}

function leaveThreadRoom(socket, threadId) {
    const roomName = `thread:${threadId}`;
    socket.leave(roomName);
    console.log(`Socket ${socket.id} left thread room: ${roomName}`);
}

module.exports = {
    joinWorkspaceRoom,
    joinThreadRoom,
    leaveThreadRoom
};
