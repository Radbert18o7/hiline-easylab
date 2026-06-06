import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/search?q=searchTerm&fingerprint=xxx&userName=xxx&ip=xxx
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const fingerprint = searchParams.get('fingerprint');
    const userName = searchParams.get('userName');
    const ip = searchParams.get('ip');

    if (!q) {
      return NextResponse.json({ results: [] });
    }

    // Search pickwave documents by pickwave_id
    const { data: pickwaveDocs } = await supabaseAdmin
      .from('pickwave_documents')
      .select('*')
      .ilike('pickwave_id', `%${q}%`)
      .order('uploaded_at', { ascending: false })
      .limit(20);

    // Search labels documents by pickwave_id
    const { data: labelsDocs } = await supabaseAdmin
      .from('labels_documents')
      .select('*')
      .ilike('pickwave_id', `%${q}%`)
      .order('uploaded_at', { ascending: false })
      .limit(20);

    // Combine results — group labels under their pickwave
    const results = (pickwaveDocs || []).map(pw => ({
      ...pw,
      type: 'pickwave',
      labels: (labelsDocs || []).filter(l => l.pickwave_id === pw.pickwave_id),
    }));

    // Also include labels that match but whose pickwave wasn't found directly
    const matchedPickwaveIds = new Set(results.map(r => r.pickwave_id));
    const orphanLabels = (labelsDocs || []).filter(l => !matchedPickwaveIds.has(l.pickwave_id));
    for (const label of orphanLabels) {
      results.push({
        pickwave_id: label.pickwave_id,
        type: 'labels-only',
        labels: [label],
      });
    }

    // Log search action
    if (fingerprint) {
      await supabaseAdmin.from('activity_logs').insert({
        user_fingerprint: fingerprint,
        user_name: userName,
        ip,
        action: 'search',
        metadata: { query: q, results_count: results.length },
      });
    }

    return NextResponse.json({ results, query: q });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
