import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { processLabelsPdf } from '@/lib/pdfProcessor';

export const maxDuration = 300;

export async function POST(request) {
  console.log('[route.js] POST /api/process-labels called at', new Date().toISOString());
  try {
    const formData = await request.formData();
    const labelsFile = formData.get('labelsFile');
    const pickwaveId = formData.get('pickwaveId');
    const fingerprint = formData.get('fingerprint');
    const userName = formData.get('userName');
    const ip = formData.get('ip');

    console.log('[route.js] formData fields — labelsFile:', !!labelsFile, '| pickwaveId:', pickwaveId, '| userName:', userName);

    if (!labelsFile || !pickwaveId) {
      console.error('[route.js] Missing labelsFile or pickwaveId');
      return NextResponse.json({ error: 'labelsFile and pickwaveId required' }, { status: 400 });
    }

    // 1. Fetch pickwave document record
    console.log('[route.js] Fetching pickwave from DB for pickwave_id:', pickwaveId);
    const { data: pickwaveDoc, error: pwError } = await supabaseAdmin
      .from('pickwave_documents')
      .select('*')
      .eq('pickwave_id', pickwaveId)
      .single();

    if (pwError || !pickwaveDoc) {
      console.error('[route.js] Pickwave not found in DB:', pwError?.message);
      return NextResponse.json({ error: 'Pickwave document not found' }, { status: 404 });
    }
    console.log('[route.js] Pickwave doc found. file_url:', pickwaveDoc.file_url);

    const labelsBuffer = Buffer.from(await labelsFile.arrayBuffer());
    console.log('[route.js] Labels buffer size:', labelsBuffer.length, 'bytes');

    const timestamp = Date.now();
    const originalFileName = `${pickwaveId}_original_${timestamp}.pdf`;

    // 2. Upload original labels to storage
    console.log('[route.js] Uploading original labels to storage as:', originalFileName);
    await supabaseAdmin.storage
      .from('labels')
      .upload(originalFileName, labelsBuffer, { contentType: 'application/pdf', upsert: false });
    console.log('[route.js] Original upload done');

    const { data: origUrlData } = supabaseAdmin.storage.from('labels').getPublicUrl(originalFileName);
    const originalFileUrl = origUrlData.publicUrl;
    console.log('[route.js] Original file URL:', originalFileUrl);

    // 3. Download the pickwave PDF and extract text
    let pickwaveRawText = '';
    try {
      console.log('[route.js] Fetching pickwave PDF from URL:', pickwaveDoc.file_url);
      const pwRes = await fetch(pickwaveDoc.file_url);
      console.log('[route.js] Pickwave fetch status:', pwRes.status, pwRes.statusText);
      if (pwRes.ok) {
        const pickwaveBuffer = Buffer.from(await pwRes.arrayBuffer());
        console.log('[route.js] Pickwave PDF buffer size:', pickwaveBuffer.length, 'bytes');

        console.log('[route.js] Importing pdf-parse...');
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        console.log('[route.js] pdf-parse imported OK');

        const pwData = await pdfParse(pickwaveBuffer);
        pickwaveRawText = pwData.text;
        console.log('[route.js] Pickwave text extracted. Length:', pickwaveRawText.length);
        console.log('[route.js] Pickwave raw text sample:', pickwaveRawText.substring(0, 500));
      } else {
        console.error('[route.js] Pickwave PDF fetch FAILED:', pwRes.status, pwRes.statusText);
      }
    } catch (e) {
      console.error('[route.js] Pickwave fetch/parse ERROR:', e.message, e.stack);
    }

    if (!pickwaveRawText) {
      console.error('[route.js] pickwaveRawText is EMPTY — this will cause 0 matches!');
    }

    // 4. Process labels
    console.log('[route.js] Calling processLabelsPdf...');
    const { buffer: processedBuffer, matchedCount, totalPages } = await processLabelsPdf(
      labelsBuffer,
      pickwaveRawText
    );
    console.log(`[route.js] processLabelsPdf returned: ${matchedCount}/${totalPages} matched`);

    // 5. Upload processed PDF
    const processedFileName = `${pickwaveId}_processed_${timestamp}.pdf`;
    console.log('[route.js] Uploading processed PDF as:', processedFileName);
    const { error: procUploadError } = await supabaseAdmin.storage
      .from('labels')
      .upload(processedFileName, processedBuffer, { contentType: 'application/pdf', upsert: false });

    if (procUploadError) {
      console.error('[route.js] Processed PDF upload error:', procUploadError.message);
      return NextResponse.json({ error: procUploadError.message }, { status: 500 });
    }
    console.log('[route.js] Processed PDF uploaded OK');

    const { data: procUrlData } = supabaseAdmin.storage.from('labels').getPublicUrl(processedFileName);
    const processedFileUrl = procUrlData.publicUrl;
    console.log('[route.js] Processed file URL:', processedFileUrl);

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

    if (dbError) console.error('[route.js] DB insert error:', dbError.message);
    else console.log('[route.js] DB insert OK, record id:', labelRecord?.id);

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
    console.log('[route.js] Activity logged');

    console.log('[route.js] Returning success response');
    return NextResponse.json({
      success: true,
      originalFileUrl,
      processedFileUrl,
      matchedCount,
      totalPages,
      record: labelRecord,
    });

  } catch (err) {
    console.error('[route.js] UNHANDLED ERROR:', err.message, '\nStack:', err.stack);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
