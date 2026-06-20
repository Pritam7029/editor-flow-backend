const { supabaseAdmin } = require('../config/supabase');

async function getPlanLimitsForOwner(ownerId) {
    // 1. Get billing account
    const { data: billingAccount, error: baError } = await supabaseAdmin
        .from('billing_accounts')
        .select('*')
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (baError || !billingAccount) {
        // Fallback or default to Free plan limits if no billing account exists
        const { data: freePlan } = await supabaseAdmin
            .from('plans')
            .select('*')
            .eq('key', 'free')
            .single();
        return freePlan || { max_workspaces: 1, max_members: 4, max_storage_bytes: 2147483648 };
    }

    // 2. Get plan details
    const { data: plan, error: planError } = await supabaseAdmin
        .from('plans')
        .select('*')
        .eq('key', billingAccount.plan_key)
        .single();

    if (planError || !plan) {
        return { max_workspaces: 1, max_members: 4, max_storage_bytes: 2147483648 };
    }

    return plan;
}

async function getPlanLimitsForWorkspace(workspaceId) {
    // Fetch workspace
    const { data: workspace, error: wsError } = await supabaseAdmin
        .from('workspaces')
        .select('owner_id, billing_account_id')
        .eq('id', workspaceId)
        .single();

    if (wsError || !workspace) {
        throw new Error('Workspace not found');
    }

    return getPlanLimitsForOwner(workspace.owner_id);
}

// Middleware: assert workspace limit before creating workspace
async function assertCanCreateWorkspace(req, res, next) {
    try {
        const userId = req.user.id;
        const limits = await getPlanLimitsForOwner(userId);

        // Count owned workspaces
        const { count, error } = await supabaseAdmin
            .from('workspaces')
            .select('*', { count: 'exact', head: true })
            .eq('owner_id', userId);

        if (error) throw error;

        if (count >= limits.max_workspaces) {
            return res.status(403).json({
                success: false,
                code: 'PLAN_LIMIT_EXCEEDED',
                message: `Your current plan allows only ${limits.max_workspaces} workspace(s). Upgrade to create more.`
            });
        }

        next();
    } catch (err) {
        next(err);
    }
}

// Middleware/Helper: check if member limit is exceeded before adding a member
async function assertCanAddWorkspaceMember(req, res, next) {
    try {
        const workspaceId = req.params.workspaceId || req.validated.params.workspaceId;
        const limits = await getPlanLimitsForWorkspace(workspaceId);

        // Count active members
        const { count, error } = await supabaseAdmin
            .from('workspace_members')
            .select('*', { count: 'exact', head: true })
            .eq('workspace_id', workspaceId)
            .eq('status', 'active');

        if (error) throw error;

        if (count >= limits.max_members) {
            return res.status(403).json({
                success: false,
                code: 'PLAN_LIMIT_EXCEEDED',
                message: `Your workspace has reached the limit of ${limits.max_members} active members allowed by the owner's plan.`
            });
        }

        next();
    } catch (err) {
        next(err);
    }
}

// Helper: check if file upload size exceeds plan limits
async function assertCanUploadFile(req, res, next) {
    try {
        const workspaceId = req.params.workspaceId || req.validated.params.workspaceId;
        const fileSizeBytes = req.body.size || req.body.size_bytes || 0;
        const limits = await getPlanLimitsForWorkspace(workspaceId);

        // Fetch sum of file sizes
        const { data: files, error } = await supabaseAdmin
            .from('workspace_files')
            .select('size')
            .eq('workspace_id', workspaceId);

        if (error) throw error;

        const currentStorage = (files || []).reduce((sum, file) => sum + Number(file.size || 0), 0);

        if (currentStorage + fileSizeBytes > limits.max_storage_bytes) {
            const limitGb = (limits.max_storage_bytes / (1024 * 1024 * 1024)).toFixed(1);
            return res.status(403).json({
                success: false,
                code: 'PLAN_LIMIT_EXCEEDED',
                message: `Storage limit exceeded. This upload would exceed the plan storage limit of ${limitGb} GB.`
            });
        }

        next();
    } catch (err) {
        next(err);
    }
}

module.exports = {
    assertCanCreateWorkspace,
    assertCanAddWorkspaceMember,
    assertCanUploadFile,
    getPlanLimitsForOwner,
    getPlanLimitsForWorkspace
};
