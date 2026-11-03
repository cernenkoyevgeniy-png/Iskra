import { supabase } from '@/lib/supabase';
import type { DirectMessage } from '@/lib/types';

export async function fetchDirectMessages(otherUserId: string): Promise<DirectMessage[]> {
  const me = (await supabase.auth.getUser()).data.user;
  if (!me) throw new Error('Не авторизован');

  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .or(`and(sender_id.eq.${me.id},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${me.id})`)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DirectMessage[];
}

export async function sendDirectMessage(recipientId: string, body: string): Promise<DirectMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Пустое сообщение');
  const me = (await supabase.auth.getUser()).data.user;
  if (!me) throw new Error('Не авторизован');
  const { data, error } = await supabase
    .from('direct_messages')
    .insert({ sender_id: me.id, recipient_id: recipientId, body: trimmed })
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    // RLS может не дать прочитать строку сразу после insert — вернём известные поля.
    return {
      id: '',
      sender_id: me.id,
      recipient_id: recipientId,
      body: trimmed,
      read_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
    } as DirectMessage;
  }
  return data as DirectMessage;
}

export async function markDirectMessageRead(messageId: string) {
  const { error } = await supabase
    .from('direct_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
    .is('read_at', null);
  if (error) throw error;
}

export async function markConversationRead(otherUserId: string) {
  const { error } = await supabase
    .from('direct_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sender_id', otherUserId)
    .eq('recipient_id', (await supabase.auth.getUser()).data.user?.id)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Soft-delete своего сообщения: обнуляет тело и ставит deleted_at.
 * Строка остаётся, чтобы оба участника видели «Сообщение удалено».
 * RLS разрешает UPDATE только отправителю (для soft-delete) и получателю (для read_at).
 */
export async function deleteDirectMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('direct_messages')
    .update({ body: '', deleted_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

export type ConversationRow = {
  other_user_id: string;
  other_nickname: string;
  other_avatar: string | null;
  last_body: string;
  last_at: string;
  unread: number;
};

export async function fetchConversations(): Promise<ConversationRow[]> {
  const { data, error } = await supabase.rpc('list_conversations');
  if (error) throw error;
  return (data ?? []) as ConversationRow[];
}

export async function getUnreadTotal(): Promise<number> {
  const me = (await supabase.auth.getUser()).data.user;
  if (!me) return 0;
  const { count, error } = await supabase
    .from('direct_messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', me.id)
    .is('read_at', null);
  if (error) return 0;
  return count ?? 0;
}
