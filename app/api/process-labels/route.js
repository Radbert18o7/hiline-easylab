import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { processLabelsPdf } from '@/lib/pdfProcessor';

export const maxDuration = 300;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const labelsFile = formData.get('labelsFile');
    const pickwaveId = formData.get('pickwaveId');
    const fingerprint = formData.get('fingerprint');
    const userName = formData.get('userName');
    const ip = formData.get('ip');

    if (!labelsFile || !pickwaveId) {
      return NextResponse.json({ error: 'labelsFile and pickwaveId required' }, { status: 400 });
    }

    // 1. Fetch pickwave document record
    const { data: pickwaveDoc, error: pwError } = await supabaseAdmin
      .from('pickwave_documents')
      .select('*')
      .eq('pickwave_id', pickwaveId)
      .single();

    if (pwError || !pickwaveDoc) {
      return NextResponse.json({ error: 'Pickwave document not found' }, { status: 404 });
    }

    const labelsBuffer = Buffer.from(await labelsFile.arrayBuffer());
    const timestamp = Date.now();
    const originalFileName = `${pickwaveId}_original_${timestamp}.pdf`;

    // 2. Upload original labels to storage
    await supabaseAdmin.storage
      .from('labels')
      .upload(originalFileName, labelsBuffer, { contentType: 'application/pdf', upsert: false });

    const { data: origUrlData } = supabaseAdmin.storage.from('labels').getPublicUrl(originalFileName);
    const originalFileUrl = origUrlData.publicUrl;

    // 3. Download the pickwave PDF
    let pickwaveRawText = '';
    try {
      const pwRes = await fetch(pickwaveDoc.file_url);
      if (pwRes.ok) {
        const pickwaveBuffer = Buffer.from(await pwRes.arrayBuffer());

        // Extract text from pickwave PDF using pdf-parse
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        const pwData = await pdfParse(pickwaveBuffer);
        pickwaveRawText = pwData.text;

        console.log('Pickwave raw text sample:', pickwaveRawText.substring(0, 500));
      }
    } catch (e) {
      console.warn('Could not fetch/parse pickwave file:', e.message);
    }

    // 4. Process labels — pass raw text directly (pdfProcessor builds the SKU map internally)
    const { buffer: processedBuffer, matchedCount, totalPages } = await processLabelsPdf(
      labelsBuffer,
      pickwaveRawText   // ← raw text string, not pre-parsed array
    );

    console.log(`Processing complete: ${matchedCount}/${totalPages} labels matched`);

    // 5. Upload processed PDF
    const processedFileName = `${pickwaveId}_processed_${timestamp}.pdf`;
    const { error: procUploadError } = await supabaseAdmin.storage
      .from('labels')
      .upload(processedFileName, processedBuffer, { contentType: 'application/pdf', upsert: false });

    if (procUploadError) {
      return NextResponse.json({ error: procUploadError.message }, { status: 500 });
    }

    const { data: procUrlData } = supabaseAdmin.storage.from('labels').getPublicUrl(processedFileName);
    const processedFileUrl = procUrlData.publicUrl;

    // 6. Save record to DB
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: labelRecord, error: dbError } = await supabaseAdmin
      .from('labels_documents')
      .insert({
        pickwave_id: pickwaveId,
        original_file_url: originalFileUrl,
        processed_file_url: processedFileUrl,
        uploaded_by_fingerprint: fingerprint,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (dbError) console.error('DB insert error:', dbError);

    // 7. Log action
    await supabaseAdmin.from('activity_logs').insert({
      user_fingerprint: fingerprint,
      user_name: userName,
      ip,
      action: 'upload_labels',
      metadata: {
        pickwave_id: pickwaveId,
        original_file_url: originalFileUrl,
        processed_file_url: processedFileUrl,
        matched_count: matchedCount,
        total_pages: totalPages,
      },
    });

    return NextResponse.json({
      success: true,
      originalFileUrl,
      processedFileUrl,
      matchedCount,
      totalPages,
      record: labelRecord,
    });

  } catch (err) {
    console.error('Process labels error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
