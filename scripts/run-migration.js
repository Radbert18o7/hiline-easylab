/**
 * Direct database migration using pg client
 * Supabase provides a direct Postgres connection via Transaction Pooler
 * Run: node scripts/run-migration.js
 */

const { Client } = require('pg');

// Supabase Transaction Pooler connection
// Host format: aws-0-{region}.pooler.supabase.com
// Port: 6543 (transaction pooler)
// User: postgres.{project-ref}
// Password: your database password

// We'll use the REST API approach since we don't have the DB password
// Instead, let's use Supabase's built-in SQL API via the anon key + service role
// by making the tables directly

async function runMigrationViaSupa() {
  const { createClient } = require('@supabase/supabase-js');
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ksxlfcbzgzcjkxewykhk.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'SUPABASE_SERVICE_ROLE_KEY_HERE',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  console.log('🗄️  Checking database state...\n');

  // Check if tables exist
  const tables = ['users', 'pickwave_documents', 'labels_documents', 'activity_logs', 'chat_messages'];
  
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('count').limit(1);
    if (error && error.code === 'PGRST205') {
      console.log(`❌ Table '${table}' NOT FOUND`);
    } else if (error) {
      console.log(`⚠️  Table '${table}': ${error.message}`);
    } else {
      console.log(`✅ Table '${table}' exists`);
    }
  }

  console.log('\n📋 To create missing tables, run the SQL in supabase_schema.sql');
  console.log('   Dashboard: https://supabase.com/dashboard/project/ksxlfcbzgzcjkxewykhk/sql/new\n');
}

runMigrationViaSupa().catch(console.error);
