import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// POST /api/logs  — add log entry
export async function POST(request) {
  try {
    const body = await request.json();
    const { user_fingerprint, user_name, ip, action, metadata } = body;

    const { error } = await supabaseAdmin
      .from('activity_logs')
      .insert({
        user_fingerprint,
        user_name,
        ip,
        action,
        metadata: metadata || {},
      });

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Log error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/logs?action=xxx&from=date&to=date&page=1&limit=50
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (action) query = query.eq('action', action);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error, count } = await query;

    if (error) throw error;
    return NextResponse.json({ logs: data, total: count, page, limit });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
