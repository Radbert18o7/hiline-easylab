import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/chat/messages  — get last 50 messages
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Return in chronological order
    return NextResponse.json({ messages: (data || []).reverse() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/chat/messages  — save a message
export async function POST(request) {
  try {
    const body = await request.json();
    const { user_fingerprint, user_name, message } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: 'message required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .insert({ user_fingerprint, user_name, message: message.trim() })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ message: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
