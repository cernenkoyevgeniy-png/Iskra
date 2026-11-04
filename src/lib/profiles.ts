import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export async function searchProfiles(opts: {
  query?: string;
  interests?: string[];
  limit?: number;
}): Promise<Profile[]> {
  const { query = '', interests = [], limit = 50 } = opts;
  const { data, error } = await supabase.rpc('search_profiles', {
    nick_query: query,
    interest_filter: interests.length ? interests : null,
    limit_count: limit,
  });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function getProfile(id: string): Promise<Profile | null> {
  return getProfileVisible(id);
}

export async function checkNicknameTaken(nickname: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_nickname_available', { p_nickname: nickname });
  if (error) throw error;
  return !data;
}

export async function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'nickname' | 'avatar_url' | 'bio' | 'interests' | 'hidden_from_search' | 'hidden_from_match' | 'school' | 'grade' | 'show_school' | 'dm_privacy'>>,
) {
  // Без .select(): RETURNING * запросил бы school/grade/show_school, на которые
  // у authenticated нет SELECT-привилегии — весь UPDATE упал бы с 42501,
  // и avatar_url не сохранялся бы. Обновлённый профиль грузится через RPC.
  const { error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function blockUser(blockedId: string) {
  const { error } = await supabase
    .from('blocks')
    .insert({ blocked_id: blockedId });
  if (error) throw error;
}

export async function unblockUser(blockedId: string) {
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocked_id', blockedId);
  if (error) throw error;
}

export async function listBlockedUsers(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id, profiles:profiles!blocks_blocked_id_fkey(id, nickname, avatar_url, bio, interests, hidden_from_search, created_at, updated_at)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as { profiles: Profile }[]).map((r) => ({
    ...r.profiles,
    school: null,
    grade: null,
    show_school: false,
    hidden_from_match: false,
    dm_privacy: 'all',
  }));
}

export async function isBlocked(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocked_id', userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function reportUser(reportedId: string, reason: string) {
  const { error } = await supabase
    .from('reports')
    .insert({ reported_id: reportedId, reason });
  if (error) throw error;
}

/**
 * Загружает файл аватара: нормализует формат (HEIC → JPEG через canvas),
 * обрезает в квадрат 512×512, грузит в storage bucket 'avatars' и возвращает
 * публичный URL с cache-busting. Проверяет тип и размер.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const { cropToSquareBlob, uploadAvatarBlob } = await import('@/lib/avatar');
  const blob = await cropToSquareBlob(file);
  return uploadAvatarBlob(userId, blob, 'jpg');
}

/**
 * Удаляет аватар из storage (best effort) и очищает avatar_url в профиле.
 */
export async function removeAvatar(userId: string, currentUrl: string): Promise<void> {
  const { removeAvatarFromStorage } = await import('@/lib/avatar');
  await removeAvatarFromStorage(currentUrl);
  await updateProfile(userId, { avatar_url: null });
}

export type RecommendedUser = {
  id: string;
  nickname: string;
  avatar_url: string | null;
  bio: string;
  interests: string[];
  school: string | null;
  grade: string | null;
  common_interests: number;
  recommended_reason: string[];
};

export async function listRecommended(limit = 20): Promise<RecommendedUser[]> {
  const { data, error } = await supabase.rpc('list_recommended', { limit_count: limit });
  if (error) throw error;
  return (data ?? []) as RecommendedUser[];
}

export async function searchBySchool(school: string, grade: string, limit = 50): Promise<RecommendedUser[]> {
  const { data, error } = await supabase.rpc('search_by_school', {
    school_query: school,
    grade_query: grade,
    limit_count: limit,
  });
  if (error) throw error;
  return (data ?? []) as RecommendedUser[];
}

export async function getProfileVisible(targetId: string): Promise<Profile | null> {
  const { data, error } = await supabase.rpc('get_profile_visible', { target_id: targetId });
  if (error) throw error;
  return data as Profile | null;
}
