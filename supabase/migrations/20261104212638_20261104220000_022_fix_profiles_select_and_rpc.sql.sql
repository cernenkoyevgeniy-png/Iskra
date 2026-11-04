/*
# Fix profiles_select_visible — exclude hidden_from_search profiles

## Problem
The profiles_select_visible policy allowed any authenticated user to SELECT
all profiles that hadn't blocked them, including profiles with 
hidden_from_search = true. While column-level grants (migration 021) prevent
reading sensitive columns, the safe columns (nickname, avatar_url, bio, etc.)
should also be hidden for profiles that opted out of search.

## Fix
- profiles_select_visible: only show profiles where:
  1. It's your own profile (id = auth.uid()), OR
  2. hidden_from_search = false AND the profile owner hasn't blocked you
- This means hidden profiles are completely invisible via direct table SELECT
- Profile data is still accessible via SECURITY DEFINER RPCs when needed
  (get_profile_visible checks blocks, search_profiles filters hidden_from_search)

## Also fixes
- get_profile_visible: now returns dm_privacy for self (needed by ProfilePage)
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. Fix profiles_select_visible
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "profiles_select_visible" ON public.profiles;

CREATE POLICY "profiles_select_visible" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      hidden_from_search = false
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE b.blocker_id = profiles.id AND b.blocked_id = auth.uid()
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 2. Fix get_profile_visible — add dm_privacy for self
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_profile_visible(target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  p record;
  can_see boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;

  SELECT * INTO p FROM profiles WHERE id = target_id;
  IF NOT FOUND THEN RETURN null; END IF;

  IF EXISTS (SELECT 1 FROM blocks WHERE blocker_id = target_id AND blocked_id = me) THEN
    RETURN null;
  END IF;

  can_see := (target_id = me) OR p.show_school;

  RETURN jsonb_build_object(
    'id', p.id,
    'nickname', p.nickname,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'interests', p.interests,
    'school', CASE WHEN can_see THEN p.school ELSE null END,
    'grade', CASE WHEN can_see THEN p.grade ELSE null END,
    'show_school', p.show_school,
    'hidden_from_search', p.hidden_from_search,
    'hidden_from_match', p.hidden_from_match,
    'dm_privacy', CASE WHEN target_id = me THEN p.dm_privacy ELSE null END,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  );
END;
$function$;
