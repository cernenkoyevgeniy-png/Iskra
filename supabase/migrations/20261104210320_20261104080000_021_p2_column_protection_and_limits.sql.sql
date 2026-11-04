/*
# P2 Security Hardening — Column-level profile protection and RPC limits

## Summary
1. Revoke broad SELECT on profiles, grant column-level SELECT only on safe columns
2. Sensitive columns (school, grade, show_school, hidden_from_match, dm_privacy) 
   are NOT directly SELECT-able — accessible only via SECURITY DEFINER RPCs
3. Add CHECK constraint on reports reason length
4. Enforce limit_count bounds on all search/match RPCs (prevent mass extraction)

## Security Changes
- REVOKE SELECT on profiles FROM authenticated
- GRANT SELECT on safe columns only: id, nickname, avatar_url, bio, interests, 
  hidden_from_search, created_at, updated_at
- school, grade, show_school, hidden_from_match, dm_privacy: NOT directly SELECT-able
- CHECK: reports.reason length <= 1000
- All search RPCs: limit_count clamped to 1..100 (50 for match cards)

## Important Notes
1. Profile owner can still UPDATE all their columns (UPDATE grants unchanged)
2. Profile owner's own data is loaded via get_profile_visible RPC (SECURITY DEFINER)
3. No data deleted or modified
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. Restrict profiles SELECT to safe columns only
-- ═══════════════════════════════════════════════════════════════
REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT (
  id, nickname, avatar_url, bio, interests, hidden_from_search, created_at, updated_at
) ON public.profiles TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2. Add CHECK constraint on reports.reason length
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_reason_length' AND conrelid = 'public.reports'::regclass) THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_reason_length CHECK (length(reason) <= 1000);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. search_profiles: cap at 100, add auth check
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_profiles(nick_query text, interest_filter text[], limit_count integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  me_interests text[];
  v_limit int := LEAST(GREATEST(limit_count, 1), 100);
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;
  SELECT interests INTO me_interests FROM profiles WHERE id = me;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'nickname', p.nickname,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'interests', p.interests,
      'school', CASE WHEN p.show_school THEN p.school ELSE null END,
      'grade', CASE WHEN p.show_school THEN p.grade ELSE null END,
      'common_interests',
      CASE WHEN me_interests IS NOT NULL THEN
        (SELECT count(*) FROM unnest(me_interests) AS i WHERE i = ANY(p.interests))
      ELSE 0 END
    ) ORDER BY p.created_at DESC), '[]'::jsonb)
    FROM profiles p
    WHERE p.id <> me
    AND p.hidden_from_search = false
    AND (nick_query IS NULL OR nick_query = '' OR p.nickname ILIKE '%' || nick_query || '%')
    AND (interest_filter IS NULL OR array_length(interest_filter, 1) IS NULL OR p.interests && interest_filter)
    AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE (b.blocker_id = me AND b.blocked_id = p.id)
      OR (b.blocker_id = p.id AND b.blocked_id = me)
    )
    LIMIT v_limit
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 4. list_recommended: cap at 100, add auth check
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.list_recommended(limit_count integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  me_interests text[];
  v_limit int := LEAST(GREATEST(limit_count, 1), 100);
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;
  SELECT interests INTO me_interests FROM profiles WHERE id = me;
  IF me_interests IS NULL OR array_length(me_interests, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'nickname', p.nickname,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'interests', p.interests,
      'school', CASE WHEN p.show_school THEN p.school ELSE null END,
      'grade', CASE WHEN p.show_school THEN p.grade ELSE null END,
      'common_interests', common.cnt,
      'recommended_reason', common.shared
    ) ORDER BY common.cnt DESC, p.nickname), '[]'::jsonb)
    FROM profiles p
    JOIN LATERAL (
      SELECT count(*) AS cnt, array_agg(i) AS shared
      FROM unnest(me_interests) AS i
      WHERE i = ANY(p.interests)
    ) AS common ON common.cnt > 0
    WHERE p.id <> me
    AND p.hidden_from_search = false
    AND p.hidden_from_match = false
    AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE (b.blocker_id = me AND b.blocked_id = p.id)
      OR (b.blocker_id = p.id AND b.blocked_id = me)
    )
    LIMIT v_limit
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 5. search_by_school: cap at 100, add auth check, enforce show_school
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_by_school(school_query text, grade_query text, limit_count integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  me_interests text[];
  v_limit int := LEAST(GREATEST(limit_count, 1), 100);
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;
  SELECT interests INTO me_interests FROM profiles WHERE id = me;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'nickname', p.nickname,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'interests', p.interests,
      'school', p.school,
      'grade', p.grade,
      'common_interests',
      CASE WHEN me_interests IS NOT NULL THEN
        (SELECT count(*) FROM unnest(me_interests) AS i WHERE i = ANY(p.interests))
      ELSE 0 END,
      'recommended_reason', ARRAY[]::text[]
    ) ORDER BY p.created_at DESC), '[]'::jsonb)
    FROM profiles p
    WHERE p.id <> me
    AND p.hidden_from_search = false
    AND p.show_school = true
    AND (school_query IS NULL OR school_query = '' OR p.school ILIKE '%' || school_query || '%')
    AND (grade_query IS NULL OR grade_query = '' OR p.grade ILIKE '%' || grade_query || '%')
    AND NOT EXISTS (
      SELECT 1 FROM blocks b
      WHERE (b.blocker_id = me AND b.blocked_id = p.id)
      OR (b.blocker_id = p.id AND b.blocked_id = me)
    )
    LIMIT v_limit
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 6. get_match_cards: cap at 50, add auth check
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_match_cards(limit_count integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  me_interests text[];
  v_limit int := LEAST(GREATEST(limit_count, 1), 50);
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;
  SELECT interests INTO me_interests FROM profiles WHERE id = me;
  IF me_interests IS NULL THEN me_interests := '{}'::text[]; END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'nickname', p.nickname,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'interests', p.interests,
      'school', CASE WHEN p.show_school THEN p.school ELSE null END,
      'grade', CASE WHEN p.show_school THEN p.grade ELSE null END,
      'common_interests', COALESCE(common.cnt, 0),
      'recommended_reason', COALESCE(common.shared, '{}'::text[]),
      'match_percent', CASE
        WHEN COALESCE(array_length(me_interests, 1), 0) = 0
        AND COALESCE(array_length(p.interests, 1), 0) = 0 THEN 0
        ELSE round(
          COALESCE(common.cnt, 0)::numeric /
          GREATEST(
            COALESCE(array_length(me_interests, 1), 0),
            COALESCE(array_length(p.interests, 1), 0)
          ) * 100
        )
      END
    ) ORDER BY (CASE WHEN common.cnt IS NULL THEN 0 ELSE common.cnt END) DESC, p.nickname), '[]'::jsonb)
    FROM profiles p
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt, array_agg(i) AS shared
      FROM unnest(me_interests) AS i
      WHERE i = ANY(p.interests)
    ) AS common ON true
    WHERE p.id <> me
    AND p.hidden_from_search = false
    AND p.hidden_from_match = false
    AND NOT EXISTS (
      SELECT 1 FROM public.match_swipes s
      WHERE s.swiper_id = me AND s.target_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = me AND b.blocked_id = p.id)
      OR (b.blocker_id = p.id AND b.blocked_id = me)
    )
    LIMIT v_limit
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 7. search_public_groups: cap at 100, add auth check
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.search_public_groups(text, integer);

CREATE FUNCTION public.search_public_groups(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, name text, avatar_url text, description text, member_count bigint, is_public boolean, is_member boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  v_limit int := LEAST(GREATEST(p_limit, 1), 100);
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.name,
    g.avatar_url,
    g.description,
    mc.cnt AS member_count,
    g.is_public,
    EXISTS(SELECT 1 FROM public.group_members gm WHERE gm.group_id = g.id AND gm.user_id = me) AS is_member
  FROM public.groups g
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS cnt FROM public.group_members x WHERE x.group_id = g.id
  ) mc ON true
  WHERE g.is_public = true
  AND (p_query IS NULL OR p_query = '' OR g.name ILIKE '%' || p_query || '%')
  ORDER BY mc.cnt DESC
  LIMIT v_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_public_groups(text, integer) TO authenticated;
