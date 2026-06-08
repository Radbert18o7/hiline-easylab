import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/users?fingerprint=xxx  — fetch user by fingerprint
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fingerprint = searchParams.get('fingerprint');

  if (!fingerprint) {
    return NextResponse.json({ error: 'fingerprint required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('fingerprint', fingerprint)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data || null });
}

// POST /api/users  — upsert user
export async function POST(request) {
  const body = await request.json();
  const { fingerprint, name, ip } = body;

  if (!fingerprint) {
    return NextResponse.json({ error: 'fingerprint required' }, { status: 400 });
  }

  const trimmedName = (name || 'Anonymous').trim();

  if (trimmedName !== 'Anonymous') {
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('fingerprint')
      .eq('name', trimmedName)
      .single();
      
    if (existing && existing.fingerprint !== fingerprint) {
      return NextResponse.json({ error: 'Username is already taken' }, { status: 409 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .upsert(
      {
        fingerprint,
        name: trimmedName,
        ip: ip || 'unknown',
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'fingerprint' }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}

// PATCH /api/users  — update user name
export async function PATCH(request) {
  const body = await request.json();
  const { fingerprint, name } = body;

  if (!fingerprint || !name) {
    return NextResponse.json({ error: 'fingerprint and name required' }, { status: 400 });
  }

  const trimmedName = name.trim();

  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('fingerprint')
    .eq('name', trimmedName)
    .single();
    
  if (existing && existing.fingerprint !== fingerprint) {
    return NextResponse.json({ error: 'Username is already taken' }, { status: 409 });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ name: trimmedName, last_seen: new Date().toISOString() })
    .eq('fingerprint', fingerprint)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}
