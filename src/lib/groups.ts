import { supabase } from '@/lib/supabase';
import type { Group, GroupMember, GroupMessage } from '@/lib/types';

export async function listMyGroups(): Promise<(Group & { member_count: number })[]> {
  const { data, error } = await supabase.rpc('list_my_groups');
  if (error) throw error;
  return (data ?? []) as (Group & { member_count: number })[];
}

export async function createGroup(name: string, description: string, isPublic: boolean): Promise<Group> {
  const { data, error } = await supabase.rpc('create_group', {
    p_name: name.trim(),
    p_description: description.trim(),
    p_is_public: isPublic,
  });
  if (error) throw error;
  if (!data) throw new Error('Не удалось создать группу');
  return data as Group;
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw error;
  return data as Group | null;
}

export type PublicGroup = {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  created_by: string;
  created_at: string;
  member_count: number;
  is_member: boolean;
};

export async function searchPublicGroups(query: string, limit = 20): Promise<PublicGroup[]> {
  const { data, error } = await supabase.rpc('search_public_groups', {
    p_query: query.trim(),
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as PublicGroup[];
}

export async function joinGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('join_group', { p_group_id: groupId });
  if (error) throw error;
}

export async function listGroupMembers(groupId: string): Promise<(GroupMember & { nickname: string; avatar_url: string | null })[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id, user_id, is_admin, joined_at, profiles!group_members_user_id_fkey(nickname, avatar_url)')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as {
    group_id: string;
    user_id: string;
    is_admin: boolean;
    joined_at: string;
    profiles: { nickname: string; avatar_url: string | null };
  }[]).map((r) => ({
    group_id: r.group_id,
    user_id: r.user_id,
    is_admin: r.is_admin,
    joined_at: r.joined_at,
    nickname: r.profiles.nickname,
    avatar_url: r.profiles.avatar_url,
  }));
}

export async function addGroupMember(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('create_group_invitation', {
    p_group_id: groupId,
    p_invitee_id: userId,
  });
  if (error) throw error;
}

export type GroupInvitation = {
  id: string;
  group_id: string;
  group_name: string;
  inviter_id: string;
  inviter_nickname: string;
  created_at: string;
};

export async function listMyInvitations(): Promise<GroupInvitation[]> {
  const { data, error } = await supabase.rpc('list_my_invitations');
  if (error) throw error;
  return (data ?? []) as GroupInvitation[];
}

export async function acceptInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_group_invitation', { p_invitation_id: invitationId });
  if (error) throw error;
}

export async function declineInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_group_invitation', { p_invitation_id: invitationId });
  if (error) throw error;
}

export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function setGroupAdmin(groupId: string, userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase
    .from('group_members')
    .update({ is_admin: isAdmin })
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function leaveGroup(groupId: string): Promise<void> {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id);
  if (error) throw error;
}

export async function fetchGroupMessages(groupId: string): Promise<GroupMessage[]> {
  const { data, error } = await supabase
    .from('group_messages')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as GroupMessage[];
}

export async function sendGroupMessage(groupId: string, body: string): Promise<GroupMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Пустое сообщение');
  const me = (await supabase.auth.getUser()).data.user;
  if (!me) throw new Error('Не авторизован');
  const { data, error } = await supabase
    .from('group_messages')
    .insert({ group_id: groupId, sender_id: me.id, body: trimmed })
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      id: '',
      group_id: groupId,
      sender_id: me.id,
      body: trimmed,
      created_at: new Date().toISOString(),
    } as GroupMessage;
  }
  return data as GroupMessage;
}
