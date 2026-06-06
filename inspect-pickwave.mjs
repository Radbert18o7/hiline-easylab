import { createClient } from '@supabase/supabase-js';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('pickwave_documents')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data.length) {
    console.error('Error fetching pickwave:', error);
    return;
  }

  const pw = data[0];
  console.log('Fetching Pickwave:', pw.file_url);

  const res = await fetch(pw.file_url);
  const buffer = Buffer.from(await res.arrayBuffer());
  const pwData = await pdfParse(buffer);
  
  const text = pwData.text;
  console.log("--- START TEXT ---\n");
  console.log(text.substring(0, 3000));
  console.log("\n--- END TEXT ---");
}

run();
