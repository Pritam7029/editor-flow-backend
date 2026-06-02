const { supabaseAdmin } = require('./src/config/supabase');

async function test() {
    try {
        console.log('Querying information_schema for workspace_members table...');
        
        const { data, error } = await supabaseAdmin
            .rpc('get_table_info', {}); // Let's check if we can query directly using postgrest or sql

        // Since we don't have get_table_info RPC, we can query postgrest info or do a select * limit 1
        const { data: memberData, error: memberError } = await supabaseAdmin
            .from('workspace_members')
            .select('*')
            .limit(1);

        console.log('Sample workspace_member:', memberData, memberError);
    } catch (err) {
        console.error('Exception occurred:', err);
    }
}

test();
