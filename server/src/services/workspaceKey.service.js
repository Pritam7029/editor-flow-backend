const { supabaseAdmin } = require('../config/supabase');

async function getWorkspaceKeyGrants(workspaceId) {
    const { data, error } = await supabaseAdmin
        .from('workspace_key_grants')
        .select(`
            id,
            workspace_id,
            workspace_key_id,
            recipient_user_id,
            encrypted_workspace_key,
            grant_algorithm,
            created_at,
            workspace_encryption_keys!workspace_key_id (
                key_version
            )
        `)
        .eq('workspace_id', workspaceId)
        .is('revoked_at', null);

    if (error) throw error;
    return data || [];
}

async function createWorkspaceKeyGrant(workspaceId, {
    keyVersion,
    keyAlgorithm,
    recipientUserId,
    encryptedWorkspaceKey,
    grantAlgorithm,
    grantedBy
}) {
    // 1. Ensure the key version exists
    let { data: keyVersionRow, error: keyVerError } = await supabaseAdmin
        .from('workspace_encryption_keys')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('key_version', keyVersion)
        .maybeSingle();

    if (keyVerError) throw keyVerError;

    if (!keyVersionRow) {
        // Create the new key version row
        const { data: newKeyRow, error: insertKeyError } = await supabaseAdmin
            .from('workspace_encryption_keys')
            .insert({
                workspace_id: workspaceId,
                key_version: keyVersion,
                algorithm: keyAlgorithm || 'AES-GCM',
                status: 'active',
                created_by: grantedBy
            })
            .select()
            .single();

        if (insertKeyError) throw insertKeyError;
        keyVersionRow = newKeyRow;
    }

    // 2. Insert the grant
    const { data: grant, error: grantError } = await supabaseAdmin
        .from('workspace_key_grants')
        .insert({
            workspace_id: workspaceId,
            workspace_key_id: keyVersionRow.id,
            recipient_user_id: recipientUserId,
            encrypted_workspace_key: encryptedWorkspaceKey,
            grant_algorithm: grantAlgorithm || 'RSA-OAEP',
            granted_by: grantedBy
        })
        .select()
        .single();

    if (grantError) {
        // Handle unique constraint conflict by returning existing, or throw
        if (grantError.code === '23505') {
            const { data: existingGrant, error: getExistError } = await supabaseAdmin
                .from('workspace_key_grants')
                .select('*')
                .eq('workspace_key_id', keyVersionRow.id)
                .eq('recipient_user_id', recipientUserId)
                .maybeSingle();
            if (getExistError) throw getExistError;
            return existingGrant;
        }
        throw grantError;
    }

    return grant;
}

async function getMyWorkspaceKeyGrant(workspaceId, userId) {
    const { data, error } = await supabaseAdmin
        .from('workspace_key_grants')
        .select(`
            id,
            workspace_id,
            workspace_key_id,
            recipient_user_id,
            encrypted_workspace_key,
            grant_algorithm,
            workspace_encryption_keys!workspace_key_id (
                id,
                key_version,
                algorithm,
                status
            )
        `)
        .eq('workspace_id', workspaceId)
        .eq('recipient_user_id', userId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Return the latest active grant
    if (data && data.length > 0) {
        return data[0];
    }
    return null;
}

async function rotateWorkspaceKey(workspaceId, { newVersion, algorithm, creatorId, grants }) {
    // 1. Mark existing keys as rotated / inactive
    const { error: updateError } = await supabaseAdmin
        .from('workspace_encryption_keys')
        .update({ status: 'rotated' })
        .eq('workspace_id', workspaceId);

    if (updateError) throw updateError;

    // 2. Create new key version
    const { data: newKeyRow, error: insertKeyError } = await supabaseAdmin
        .from('workspace_encryption_keys')
        .insert({
            workspace_id: workspaceId,
            key_version: newVersion,
            algorithm: algorithm || 'AES-GCM',
            status: 'active',
            created_by: creatorId
        })
        .select()
        .single();

    if (insertKeyError) throw insertKeyError;

    // 3. Create key grants for all specified approved users
    const grantRows = grants.map(g => ({
        workspace_id: workspaceId,
        workspace_key_id: newKeyRow.id,
        recipient_user_id: g.recipientUserId,
        encrypted_workspace_key: g.encryptedWorkspaceKey,
        grant_algorithm: g.grantAlgorithm || 'RSA-OAEP',
        granted_by: creatorId
    }));

    const { data: createdGrants, error: insertGrantsError } = await supabaseAdmin
        .from('workspace_key_grants')
        .insert(grantRows)
        .select();

    if (insertGrantsError) throw insertGrantsError;

    return {
        key: newKeyRow,
        grants: createdGrants
    };
}

async function getWorkspaceMemberEncryptionIdentities(workspaceId) {
    const { data: members, error: memError } = await supabaseAdmin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active');

    if (memError) throw memError;

    const userIds = (members || []).map(m => m.user_id);
    if (userIds.length === 0) return [];

    const { data: identities, error: identError } = await supabaseAdmin
        .from('user_encryption_identities')
        .select('id, user_id, public_key, key_algorithm, created_at')
        .in('user_id', userIds)
        .eq('status', 'active');

    if (identError) throw identError;
    return identities || [];
}

module.exports = {
    getWorkspaceKeyGrants,
    createWorkspaceKeyGrant,
    getMyWorkspaceKeyGrant,
    rotateWorkspaceKey,
    getWorkspaceMemberEncryptionIdentities
};

