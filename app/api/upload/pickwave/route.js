import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const pickwaveId = formData.get('pickwaveId');
    const fingerprint = formData.get('fingerprint');
    const userName = formData.get('userName');
    const ip = formData.get('ip');

    if (!file || !pickwaveId) {
      return NextResponse.json({ error: 'file and pickwaveId required' }, { status: 400 });
    }

    // Validate pickwave ID uniqueness
    const { data: existing } = await supabaseAdmin
      .from('pickwave_documents')
      .select('id')
      .eq('pickwave_id', pickwaveId)
      .single();

    if (existing) {
      return NextResponse.json({ error: `Pickwave ID "${pickwaveId}" already exists` }, { status: 409 });
    }

    // Upload to Supabase storage
    const fileBuffer = await file.arrayBuffer();
    const fileName = `${pickwaveId}.pdf`;

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('pickwave-docs')
      .upload(fileName, Buffer.from(fileBuffer), {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('pickwave-docs')
      .getPublicUrl(fileName);

    const fileUrl = urlData.publicUrl;

    // Insert record
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: record, error: dbError } = await supabaseAdmin
      .from('pickwave_documents')
      .insert({
        pickwave_id: pickwaveId,
        file_url: fileUrl,
        uploaded_by_fingerprint: fingerprint,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    // Log action
    await supabaseAdmin.from('activity_logs').insert({
      user_fingerprint: fingerprint,
      user_name: userName,
      ip,
      action: 'upload_pickwave',
      metadata: { pickwave_id: pickwaveId, file_url: fileUrl, file_name: file.name },
    });

    return NextResponse.json({ success: true, record, fileUrl });
  } catch (err) {
    console.error('Upload pickwave error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/upload/pickwave  — list all pickwave docs
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('pickwave_documents')
    .select('*')
    .order('uploaded_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data });
}
