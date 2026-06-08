const { supabaseAdmin } = require('../config/supabase');

const STORAGE_BUCKET = 'workspace-files';

/**
 * Clean a file name to be safe for URLs and storage systems.
 */
function getSafeFileName(name) {
    if (!name) return 'file';
    return name.replace(/[^a-zA-Z0-9.-]/g, '_');
}

/**
 * Initialize a new file upload. Creates database records in status 'uploading'
 * and returns the pre-signed upload URL.
 */
async function initFileUploadService(workspaceId, userId, payload) {
    const { name, size_bytes, mime_type } = payload;
    const safeName = getSafeFileName(name);

    // 1. Create file record
    const { data: file, error: fileError } = await supabaseAdmin
        .from('files')
        .insert({
            workspace_id: workspaceId,
            uploaded_by: userId,
            name: name,
            file_type: mime_type.startsWith('video/') ? 'video' : 'other',
            mime_type: mime_type,
            size_bytes: size_bytes,
            status: 'uploading'
        })
        .select()
        .single();

    if (fileError || !file) {
        throw fileError || new Error('Failed to create file record');
    }

    // 2. Create version 1 record
    const { data: version, error: versionError } = await supabaseAdmin
        .from('file_versions')
        .insert({
            file_id: file.id,
            workspace_id: workspaceId,
            version_number: 1,
            uploaded_by: userId,
            size_bytes: size_bytes,
            status: 'uploading'
        })
        .select()
        .single();

    if (versionError || !version) {
        // Rollback file record if version creation fails
        await supabaseAdmin.from('files').delete().eq('id', file.id);
        throw versionError || new Error('Failed to create file version record');
    }

    // 3. Compute storage path
    const storagePath = `workspaces/${workspaceId}/files/${file.id}/versions/${version.id}/${safeName}`;

    // 4. Create signed upload URL
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUploadUrl(storagePath);

    if (uploadError || !uploadData) {
        // Rollback records
        await supabaseAdmin.from('files').delete().eq('id', file.id);
        throw uploadError || new Error('Failed to create signed upload URL');
    }

    // 5. Update records with storage path and bucket
    await supabaseAdmin
        .from('files')
        .update({
            storage_bucket: STORAGE_BUCKET,
            storage_path: storagePath
        })
        .eq('id', file.id);

    await supabaseAdmin
        .from('file_versions')
        .update({
            storage_bucket: STORAGE_BUCKET,
            storage_path: storagePath
        })
        .eq('id', version.id);

    return {
        file: {
            id: file.id,
            workspace_id: file.workspace_id,
            name: file.name,
            file_type: file.file_type,
            status: 'uploading',
            created_at: file.created_at
        },
        version: {
            id: version.id,
            version_number: 1,
            status: 'uploading'
        },
        bucket: STORAGE_BUCKET,
        storagePath,
        signedUrl: uploadData.signedUrl,
        token: uploadData.token
    };
}

/**
 * Initialize upload for a new version of an existing file.
 */
async function createFileVersionService(workspaceId, fileId, userId, payload) {
    const { name, size_bytes, mime_type } = payload;
    const safeName = getSafeFileName(name);

    // 1. Fetch file to check existence
    const { data: file, error: fileFetchError } = await supabaseAdmin
        .from('files')
        .select('*')
        .eq('id', fileId)
        .eq('workspace_id', workspaceId)
        .single();

    if (fileFetchError || !file) {
        throw fileFetchError || new Error('File not found in this workspace');
    }

    // 2. Fetch the highest version number
    const { data: versions, error: versionsError } = await supabaseAdmin
        .from('file_versions')
        .select('version_number')
        .eq('file_id', fileId)
        .order('version_number', { ascending: false });

    if (versionsError) {
        throw versionsError;
    }

    const latestVersionNum = (versions && versions.length > 0) ? versions[0].version_number : 0;
    const newVersionNum = latestVersionNum + 1;

    // 3. Create version record in database
    const { data: version, error: versionError } = await supabaseAdmin
        .from('file_versions')
        .insert({
            file_id: fileId,
            workspace_id: workspaceId,
            version_number: newVersionNum,
            uploaded_by: userId,
            size_bytes: size_bytes,
            status: 'uploading'
        })
        .select()
        .single();

    if (versionError || !version) {
        throw versionError || new Error('Failed to create file version record');
    }

    // 4. Compute storage path
    const storagePath = `workspaces/${workspaceId}/files/${fileId}/versions/${version.id}/${safeName}`;

    // 5. Create signed upload URL
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUploadUrl(storagePath);

    if (uploadError || !uploadData) {
        await supabaseAdmin.from('file_versions').delete().eq('id', version.id);
        throw uploadError || new Error('Failed to create signed upload URL');
    }

    // 6. Update version with storage path and bucket
    await supabaseAdmin
        .from('file_versions')
        .update({
            storage_bucket: STORAGE_BUCKET,
            storage_path: storagePath
        })
        .eq('id', version.id);

    return {
        file: {
            id: file.id,
            name: file.name
        },
        version: {
            id: version.id,
            version_number: newVersionNum,
            status: 'uploading'
        },
        bucket: STORAGE_BUCKET,
        storagePath,
        signedUrl: uploadData.signedUrl,
        token: uploadData.token
    };
}

/**
 * Complete a file or version upload, setting status to ready and generating signed playback URLs.
 */
async function completeUploadService(workspaceId, payload) {
    const { fileId, versionId, durationSeconds } = payload;

    // 1. Update the version record
    const { data: version, error: versionError } = await supabaseAdmin
        .from('file_versions')
        .update({
            status: 'ready',
            duration_seconds: durationSeconds ? Number(durationSeconds) : null,
            updated_at: new Date()
        })
        .eq('id', versionId)
        .eq('workspace_id', workspaceId)
        .select()
        .single();

    if (versionError || !version) {
        throw versionError || new Error('Failed to update file version to ready');
    }

    // 2. Generate signed playback URL for this version
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(version.storage_path, 3600); // 1 hour

    const playbackUrl = (signedUrlData && signedUrlData.signedUrl) ? signedUrlData.signedUrl : null;

    if (playbackUrl) {
        await supabaseAdmin
            .from('file_versions')
            .update({ playback_url: playbackUrl })
            .eq('id', versionId);
        version.playback_url = playbackUrl;
    }

    // 3. Update the parent file record (sets status to ready and points playback_url and size to the latest version)
    const { data: file, error: fileError } = await supabaseAdmin
        .from('files')
        .update({
            status: 'ready',
            playback_url: playbackUrl,
            size_bytes: version.size_bytes,
            updated_at: new Date()
        })
        .eq('id', fileId)
        .eq('workspace_id', workspaceId)
        .select()
        .single();

    if (fileError || !file) {
        throw fileError || new Error('Failed to update file record to ready');
    }

    return {
        file,
        version
    };
}

/**
 * List files for a workspace, hydrating each with its versions, comments, and signed URLs.
 */
async function listWorkspaceFilesService(workspaceId) {
    // 1. Fetch files
    const { data: files, error: filesError } = await supabaseAdmin
        .from('files')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

    if (filesError) throw filesError;
    if (!files || files.length === 0) return [];

    // 2. Fetch versions
    const { data: versions, error: versionsError } = await supabaseAdmin
        .from('file_versions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('version_number', { ascending: true });

    if (versionsError) throw versionsError;

    // 3. Fetch revisions with author profile
    const { data: revisions, error: revisionsError } = await supabaseAdmin
        .from('file_revisions')
        .select(`
            *,
            author:profiles!author_id (
                full_name,
                email,
                avatar_url,
                color
            )
        `)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });

    if (revisionsError) throw revisionsError;

    // 4. Generate signed playback URLs in bulk
    const paths = (versions || [])
        .filter(v => v.storage_path && v.status === 'ready')
        .map(v => v.storage_path);

    const signedUrlsMap = {};
    if (paths.length > 0) {
        const { data: urls, error: urlsError } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .createSignedUrls(paths, 3600); // 1 hour

        if (!urlsError && urls) {
            urls.forEach(item => {
                signedUrlsMap[item.path] = item.signedUrl;
            });
        }
    }

    // 5. Group versions and revisions by file ID
    const versionsByFileId = {};
    (versions || []).forEach(v => {
        const playbackUrl = signedUrlsMap[v.storage_path] || v.playback_url;
        const formattedVersion = {
            id: v.id,
            fileId: v.file_id,
            versionNumber: v.version_number,
            storagePath: v.storage_path,
            playbackUrl,
            durationSeconds: v.duration_seconds ? Number(v.duration_seconds) : null,
            sizeBytes: v.size_bytes ? Number(v.size_bytes) : null,
            status: v.status,
            uploadedBy: v.uploaded_by,
            createdAt: new Date(v.created_at).getTime()
        };
        versionsByFileId[v.file_id] = versionsByFileId[v.file_id] || [];
        versionsByFileId[v.file_id].push(formattedVersion);
    });

    const commentsByFileId = {};
    (revisions || []).forEach(r => {
        const formattedComment = {
            id: r.id,
            fileId: r.file_id,
            fileVersionId: r.file_version_id,
            authorId: r.author_id,
            authorName: (r.author && (r.author.full_name || r.author.email)) ? r.author.full_name || r.author.email : 'Unknown',
            text: r.body,
            timestamp: r.timestamp_seconds ? Number(r.timestamp_seconds) : 0,
            ts: new Date(r.created_at).getTime(),
            status: r.status,
            priority: r.priority,
            resolvedBy: r.resolved_by,
            resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : null
        };
        commentsByFileId[r.file_id] = commentsByFileId[r.file_id] || [];
        commentsByFileId[r.file_id].push(formattedComment);
    });

    // 6. Assemble response array
    return files.map(file => {
        const fileVersions = versionsByFileId[file.id] || [];
        const fileComments = commentsByFileId[file.id] || [];
        
        // Find latest version
        let latestVersion = null;
        if (fileVersions.length > 0) {
            latestVersion = fileVersions[fileVersions.length - 1];
        }

        return {
            id: file.id,
            workspace_id: file.workspace_id,
            name: file.name,
            type: file.mime_type || file.file_type || 'video/mp4',
            size: latestVersion ? latestVersion.sizeBytes : (file.size_bytes ? Number(file.size_bytes) : null),
            dataUrl: latestVersion ? latestVersion.playbackUrl : null,
            uploadedBy: file.uploaded_by,
            uploadedAt: new Date(file.created_at).getTime(),
            visibleTo: file.visible_to || [],
            status: file.status,
            latestVersionNumber: latestVersion ? latestVersion.versionNumber : 1,
            versions: fileVersions,
            comments: fileComments
        };
    });
}

/**
 * Get details of a specific file.
 */
async function getFileDetailsService(workspaceId, fileId) {
    const { data: file, error: fileError } = await supabaseAdmin
        .from('files')
        .select('*')
        .eq('id', fileId)
        .eq('workspace_id', workspaceId)
        .single();

    if (fileError || !file) {
        throw fileError || new Error('File not found');
    }

    // 1. Fetch versions
    const { data: versions, error: versionsError } = await supabaseAdmin
        .from('file_versions')
        .select('*')
        .eq('file_id', fileId)
        .order('version_number', { ascending: true });

    if (versionsError) throw versionsError;

    // 2. Fetch revisions
    const { data: revisions, error: revisionsError } = await supabaseAdmin
        .from('file_revisions')
        .select(`
            *,
            author:profiles!author_id (
                full_name,
                email,
                avatar_url,
                color
            )
        `)
        .eq('file_id', fileId)
        .order('created_at', { ascending: true });

    if (revisionsError) throw revisionsError;

    // 3. Generate signed URLs
    const paths = (versions || [])
        .filter(v => v.storage_path && v.status === 'ready')
        .map(v => v.storage_path);

    const signedUrlsMap = {};
    if (paths.length > 0) {
        const { data: urls, error: urlsError } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .createSignedUrls(paths, 3600);

        if (!urlsError && urls) {
            urls.forEach(item => {
                signedUrlsMap[item.path] = item.signedUrl;
            });
        }
    }

    // 4. Format and map
    const fileVersions = (versions || []).map(v => {
        const playbackUrl = signedUrlsMap[v.storage_path] || v.playback_url;
        return {
            id: v.id,
            fileId: v.file_id,
            versionNumber: v.version_number,
            storagePath: v.storage_path,
            playbackUrl,
            durationSeconds: v.duration_seconds ? Number(v.duration_seconds) : null,
            sizeBytes: v.size_bytes ? Number(v.size_bytes) : null,
            status: v.status,
            uploadedBy: v.uploaded_by,
            createdAt: new Date(v.created_at).getTime()
        };
    });

    const fileComments = (revisions || []).map(r => ({
        id: r.id,
        fileId: r.file_id,
        fileVersionId: r.file_version_id,
        authorId: r.author_id,
        authorName: (r.author && (r.author.full_name || r.author.email)) ? r.author.full_name || r.author.email : 'Unknown',
        text: r.body,
        timestamp: r.timestamp_seconds ? Number(r.timestamp_seconds) : 0,
        ts: new Date(r.created_at).getTime(),
        status: r.status,
        priority: r.priority,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : null
    }));

    let latestVersion = null;
    if (fileVersions.length > 0) {
        latestVersion = fileVersions[fileVersions.length - 1];
    }

    return {
        id: file.id,
        workspace_id: file.workspace_id,
        name: file.name,
        type: file.mime_type || file.file_type || 'video/mp4',
        size: latestVersion ? latestVersion.sizeBytes : (file.size_bytes ? Number(file.size_bytes) : null),
        dataUrl: latestVersion ? latestVersion.playbackUrl : null,
        uploadedBy: file.uploaded_by,
        uploadedAt: new Date(file.created_at).getTime(),
        visibleTo: file.visible_to || [],
        status: file.status,
        latestVersionNumber: latestVersion ? latestVersion.versionNumber : 1,
        versions: fileVersions,
        comments: fileComments
    };
}

/**
 * Delete a file and its associated storage assets.
 */
async function deleteFileService(workspaceId, fileId) {
    // 1. Fetch file versions to delete files from storage
    const { data: versions } = await supabaseAdmin
        .from('file_versions')
        .select('storage_path')
        .eq('file_id', fileId)
        .eq('workspace_id', workspaceId);

    const pathsToDelete = (versions || [])
        .map(v => v.storage_path)
        .filter(p => !!p);

    if (pathsToDelete.length > 0) {
        // Delete files from Supabase Storage
        await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .remove(pathsToDelete);
    }

    // 2. Delete file record from database (cascade deletes versions & revisions)
    const { error: deleteError } = await supabaseAdmin
        .from('files')
        .delete()
        .eq('id', fileId)
        .eq('workspace_id', workspaceId);

    if (deleteError) throw deleteError;

    return true;
}

/**
 * Fetch revisions for a file.
 */
async function getFileRevisionsService(workspaceId, fileId) {
    const { data: revisions, error: revisionsError } = await supabaseAdmin
        .from('file_revisions')
        .select(`
            *,
            author:profiles!author_id (
                full_name,
                email,
                avatar_url,
                color
            )
        `)
        .eq('file_id', fileId)
        .eq('workspace_id', workspaceId)
        .order('timestamp_seconds', { ascending: true });

    if (revisionsError) throw revisionsError;

    return (revisions || []).map(r => ({
        id: r.id,
        fileId: r.file_id,
        fileVersionId: r.file_version_id,
        authorId: r.author_id,
        authorName: (r.author && (r.author.full_name || r.author.email)) ? r.author.full_name || r.author.email : 'Unknown',
        text: r.body,
        timestamp: r.timestamp_seconds ? Number(r.timestamp_seconds) : 0,
        ts: new Date(r.created_at).getTime(),
        status: r.status,
        priority: r.priority,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : null
    }));
}

/**
 * Create a new file revision.
 */
async function createFileRevisionService(workspaceId, fileId, userId, payload) {
    const { fileVersionId, timestampSeconds, body, priority } = payload;

    const { data: r, error: insertError } = await supabaseAdmin
        .from('file_revisions')
        .insert({
            workspace_id: workspaceId,
            file_id: fileId,
            file_version_id: fileVersionId,
            author_id: userId,
            timestamp_seconds: timestampSeconds,
            body: body,
            priority: priority || 'normal',
            status: 'open'
        })
        .select()
        .single();

    if (insertError || !r) {
        throw insertError || new Error('Failed to insert revision');
    }

    const { data: author } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email, avatar_url, color')
        .eq('id', userId)
        .single();

    return {
        id: r.id,
        fileId: r.file_id,
        fileVersionId: r.file_version_id,
        authorId: r.author_id,
        authorName: (author && (author.full_name || author.email)) ? author.full_name || author.email : 'Unknown',
        text: r.body,
        timestamp: r.timestamp_seconds ? Number(r.timestamp_seconds) : 0,
        ts: new Date(r.created_at).getTime(),
        status: r.status,
        priority: r.priority,
        resolvedBy: r.resolved_by,
        resolvedAt: null
    };
}

/**
 * Update an existing file revision (e.g. resolve it or modify body/priority).
 */
async function updateFileRevisionService(workspaceId, fileId, revisionId, userId, payload) {
    const updates = {};
    if (payload.body !== undefined) updates.body = payload.body;
    if (payload.priority !== undefined) updates.priority = payload.priority;
    if (payload.status !== undefined) {
        updates.status = payload.status;
        if (payload.status === 'resolved') {
            updates.resolved_by = userId;
            updates.resolved_at = new Date();
        } else {
            updates.resolved_by = null;
            updates.resolved_at = null;
        }
    }
    updates.updated_at = new Date();

    const { data: r, error: updateError } = await supabaseAdmin
        .from('file_revisions')
        .update(updates)
        .eq('id', revisionId)
        .eq('file_id', fileId)
        .eq('workspace_id', workspaceId)
        .select()
        .single();

    if (updateError || !r) {
        throw updateError || new Error('Failed to update revision');
    }

    const { data: author } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('id', r.author_id)
        .single();

    let resolverName = null;
    if (r.resolved_by) {
        const { data: resolver } = await supabaseAdmin
            .from('profiles')
            .select('full_name, email')
            .eq('id', r.resolved_by)
            .single();
        resolverName = (resolver && (resolver.full_name || resolver.email)) ? resolver.full_name || resolver.email : null;
    }

    return {
        id: r.id,
        fileId: r.file_id,
        fileVersionId: r.file_version_id,
        authorId: r.author_id,
        authorName: (author && (author.full_name || author.email)) ? author.full_name || author.email : 'Unknown',
        text: r.body,
        timestamp: r.timestamp_seconds ? Number(r.timestamp_seconds) : 0,
        ts: new Date(r.created_at).getTime(),
        status: r.status,
        priority: r.priority,
        resolvedBy: r.resolved_by,
        resolvedName: resolverName,
        resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : null
    };
}

/**
 * Delete a file revision.
 */
async function deleteFileRevisionService(workspaceId, fileId, revisionId, userId) {
    // 1. Fetch revision to verify authorization
    const { data: revision, error: fetchError } = await supabaseAdmin
        .from('file_revisions')
        .select('*')
        .eq('id', revisionId)
        .eq('file_id', fileId)
        .eq('workspace_id', workspaceId)
        .single();

    if (fetchError || !revision) {
        throw fetchError || new Error('Revision not found');
    }

    // 2. Fetch membership role
    const { data: membership } = await supabaseAdmin
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();

    const isAdminOrOwner = membership && (membership.role === 'admin' || membership.role === 'owner');
    const isAuthor = revision.author_id === userId;

    if (!isAuthor && !isAdminOrOwner) {
        throw new Error('You do not have permission to delete this revision');
    }

    // 3. Delete revision
    const { error: deleteError } = await supabaseAdmin
        .from('file_revisions')
        .delete()
        .eq('id', revisionId);

    if (deleteError) throw deleteError;

    return true;
}

/**
 * Update file permissions (visibleTo list).
 */
async function updateFilePermissionsService(workspaceId, fileId, visibleTo) {
    const { data: file, error: updateError } = await supabaseAdmin
        .from('files')
        .update({
            visible_to: (visibleTo && visibleTo.length > 0) ? visibleTo : null,
            updated_at: new Date()
        })
        .eq('id', fileId)
        .eq('workspace_id', workspaceId)
        .select()
        .single();

    if (updateError || !file) {
        throw updateError || new Error('Failed to update file permissions');
    }

    return file.visible_to || [];
}

module.exports = {
    initFileUploadService,
    createFileVersionService,
    completeUploadService,
    listWorkspaceFilesService,
    getFileDetailsService,
    deleteFileService,
    getFileRevisionsService,
    createFileRevisionService,
    updateFileRevisionService,
    deleteFileRevisionService,
    updateFilePermissionsService
};
