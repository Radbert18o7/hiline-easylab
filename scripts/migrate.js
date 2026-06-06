/**
 * Database migration script using Supabase PostgREST SQL endpoint
 * Run: node scripts/migrate.js
 */

require('dotenv').config({ path: '.env.local' });

const https = require('https');

const projectRef = 'ksxlfcbzgzcjkxewykhk';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Tables to create using individual INSERT/SELECT approach
// Since Supabase PostgREST doesn't allow DDL, we use a workaround:
// Create a temporary SQL function, call it, then drop it

const FULL_SQL = `
-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  ip TEXT,
  fingerprint TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- Pickwave documents
CREATE TABLE IF NOT EXISTS pickwave_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickwave_id TEXT UNIQUE NOT NULL,
  file_url TEXT,
  uploaded_by_fingerprint TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- Labels documents
CREATE TABLE IF NOT EXISTS labels_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickwave_id TEXT REFERENCES pickwave_documents(pickwave_id) ON DELETE CASCADE,
  original_file_url TEXT,
  processed_file_url TEXT,
  uploaded_by_fingerprint TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- Activity logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_fingerprint TEXT,
  user_name TEXT,
  ip TEXT,
  action TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_fingerprint ON activity_logs(user_fingerprint);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_fingerprint TEXT,
  user_name TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickwave_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Policies (skip if exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='Allow all on users') THEN
    CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pickwave_documents' AND policyname='Allow all on pickwave_documents') THEN
    CREATE POLICY "Allow all on pickwave_documents" ON pickwave_documents FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='labels_documents' AND policyname='Allow all on labels_documents') THEN
    CREATE POLICY "Allow all on labels_documents" ON labels_documents FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='activity_logs' AND policyname='Allow all on activity_logs') THEN
    CREATE POLICY "Allow all on activity_logs" ON activity_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chat_messages' AND policyname='Allow all on chat_messages') THEN
    CREATE POLICY "Allow all on chat_messages" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
`;

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function createMigrationFunction() {
  // Create a temporary function that runs our DDL
  const createFnSql = `
    CREATE OR REPLACE FUNCTION run_migration() RETURNS void AS $$
    BEGIN
      ${FULL_SQL.replace(/'/g, "''")}
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `;

  // Use RPC to create the function first
  // This won't work via PostgREST directly...
  console.log('\n⚠️  Cannot run DDL via PostgREST API.');
  console.log('\n📋 MANUAL STEP REQUIRED:');
  console.log('   Please go to your Supabase Dashboard and run the SQL in supabase_schema.sql');
  console.log('   Dashboard URL: https://supabase.com/dashboard/project/ksxlfcbzgzcjkxewykhk/sql/new\n');
  console.log('   The SQL file is at: supabase_schema.sql in your project root');
}

async function main() {
  console.log('🗄️  HI-LINE Easy Lab — Database Migration\n');
  await createMigrationFunction();
}

main();
