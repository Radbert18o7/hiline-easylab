/**
 * Run this once to create all database tables in Supabase
 * Usage: node scripts/setup-db.js
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ksxlfcbzgzcjkxewykhk.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'SUPABASE_SERVICE_ROLE_KEY_HERE';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const SQL_STATEMENTS = [
  // Users table
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    ip TEXT,
    fingerprint TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Pickwave documents
  `CREATE TABLE IF NOT EXISTS pickwave_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pickwave_id TEXT UNIQUE NOT NULL,
    file_url TEXT,
    uploaded_by_fingerprint TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
  )`,

  // Labels documents
  `CREATE TABLE IF NOT EXISTS labels_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pickwave_id TEXT REFERENCES pickwave_documents(pickwave_id) ON DELETE CASCADE,
    original_file_url TEXT,
    processed_file_url TEXT,
    uploaded_by_fingerprint TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
  )`,

  // Activity logs
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_fingerprint TEXT,
    user_name TEXT,
    ip TEXT,
    action TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Indexes on activity_logs
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_fingerprint ON activity_logs(user_fingerprint)`,

  // Chat messages
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_fingerprint TEXT,
    user_name TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC)`,

  // Enable RLS
  `ALTER TABLE users ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE pickwave_documents ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE labels_documents ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY`,
];

const RLS_POLICIES = [
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='Allow all on users') THEN
      CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pickwave_documents' AND policyname='Allow all on pickwave_documents') THEN
      CREATE POLICY "Allow all on pickwave_documents" ON pickwave_documents FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='labels_documents' AND policyname='Allow all on labels_documents') THEN
      CREATE POLICY "Allow all on labels_documents" ON labels_documents FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='activity_logs' AND policyname='Allow all on activity_logs') THEN
      CREATE POLICY "Allow all on activity_logs" ON activity_logs FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_messages' AND policyname='Allow all on chat_messages') THEN
      CREATE POLICY "Allow all on chat_messages" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`,
];

async function runSQL(sql) {
  const { error } = await supabase.rpc('exec_sql_void', { sql_text: sql }).catch(() => ({ error: null }));
  if (error && !error.message?.includes('already exists')) {
    // Try direct query approach
    const { error: err2 } = await supabase.from('_dummy').select('*').limit(0).catch(() => ({ error: null }));
  }
}

async function setupDatabase() {
  console.log('🚀 Setting up HI-LINE Easy Lab database...\n');

  // Use the Supabase Management API approach via fetch
  const managementApiBase = 'https://api.supabase.com/v1';

  // Alternative: Use pg endpoint directly
  const pgEndpoint = `${supabaseUrl}/pg`;

  // The correct approach: use the REST API with raw SQL
  for (const sql of [...SQL_STATEMENTS, ...RLS_POLICIES]) {
    const shortSql = sql.trim().slice(0, 60).replace(/\n/g, ' ') + '...';
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_raw_sql`, {
        method: 'POST',
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql_text: sql }),
      });

      if (response.ok) {
        console.log(`✅ ${shortSql}`);
      } else {
        const errData = await response.text();
        // If function doesn't exist, try another way
        if (errData.includes('PGRST202') || errData.includes('exec_raw_sql')) {
          // Use the query endpoint directly
          await executeSqlDirect(sql, shortSql);
        } else if (!errData.includes('already exists')) {
          console.log(`⚠️  ${shortSql}`);
          console.log(`   ${errData.slice(0, 100)}`);
        } else {
          console.log(`↩️  Already exists: ${shortSql}`);
        }
      }
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
    }
  }

  // Create storage buckets
  console.log('\n📦 Setting up storage buckets...');
  await createBucket('pickwave-docs');
  await createBucket('labels');

  console.log('\n✨ Database setup complete!');
}

async function executeSqlDirect(sql, shortSql) {
  // Use the Supabase PostgreSQL API
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ query: sql }),
    });
    console.log(`  Direct: ${response.status}`);
  } catch {}
}

async function createBucket(bucketName) {
  try {
    const { data, error } = await supabase.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: 52428800, // 50MB
    });
    if (error && error.message?.includes('already exists')) {
      console.log(`↩️  Bucket already exists: ${bucketName}`);
    } else if (error) {
      console.log(`⚠️  Bucket ${bucketName}: ${error.message}`);
    } else {
      console.log(`✅ Created bucket: ${bucketName}`);
    }
  } catch (err) {
    console.log(`⚠️  Bucket ${bucketName}: ${err.message}`);
  }
}

setupDatabase().catch(console.error);
