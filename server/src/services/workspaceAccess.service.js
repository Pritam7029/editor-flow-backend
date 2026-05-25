const { supabaseAdmin } = require('../config/supabase');

async function getActiveMembership(userId, workspaceId) {
    const { data, error } = await supabaseAdmin
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

async function requireWorkspaceMember(userId, workspaceId) {
    const membership = await getActiveMembership(userId, workspaceId);

    if (!membership) {
        const error = new Error('You do not have access to this workspace');
        error.statusCode = 403;
        throw error;
    }

    return membership;
}

async function requireWorkspaceRole(userId, workspaceId, allowedRoles) {
    const membership = await requireWorkspaceMember(userId, workspaceId);

    if (!allowedRoles.includes(membership.role)) {
        const error = new Error('You do not have permission to perform this action');
        error.statusCode = 403;
        throw error;
    }

    return membership;
}

module.exports = {
    getActiveMembership,
    requireWorkspaceMember,
    requireWorkspaceRole
};