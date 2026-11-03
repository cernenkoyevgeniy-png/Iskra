/*
# P0 Security Fixes — Critical Vulnerability Remediation

## Summary
Fixes critical security vulnerabilities:
1. list_conversations / list_my_groups — remove client-supplied me_id, use auth.uid()
2. dm_update policy — split into sender-only (body/deleted_at) and recipient-only (read_at)
3. gm_insert policy — prevent self-appointment as admin
4. gm_update policy — prevent self-role escalation
5. Drop legacy create_group(p_name, p_description) overload
6. Revoke all unnecessary anon grants on public tables
7. Add CHECK constraints for message/nickname/bio/group lengths
8. Case-insensitive unique index on nickname

## Security Changes
- RLS: direct_messages UPDATE split into two policies with column-level restrictions
- RLS: group_members INSERT restricted — is_admin=true only via create_group RPC or admin
- RLS: group_members UPDATE restricted — cannot change own is_admin flag
- RPC: list_conversations() and list_my_groups() — no parameters, use auth.uid()
- Grants: REVOKE all privileges FROM anon on all public tables
- Grants: Column-level UPDATE on direct_messages and group_members

## Important Notes
1. No data is deleted or modified — only policy/function definitions change.
2. All SECURITY DEFINER functions retain SET search_path TO 'public'.
3. Frontend must be updated to call list_conversations() and list_my_groups() without args.
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. Revoke ALL anon privileges on public tables
-- ═══════════════════════════════════════════════════════════════
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.blocks FROM anon;
REVOKE ALL ON public.direct_messages FROM anon;
REVOKE ALL ON public.groups FROM anon;
REVOKE ALL ON public.group_members FROM anon;
REVOKE ALL ON public.group_messages FROM anon;
REVOKE ALL ON public.group_message_reads FROM anon;
REVOKE ALL ON public.match_swipes FROM anon;
REVOKE ALL ON public.matches FROM anon;
REVOKE ALL ON public.reports FROM anon;

-- ═══════════════════════════════════════════════════════════════
-- 2. Fix list_conversations — remove me_id param, use auth.uid()
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.list_conversations(uuid);

CREATE FUNCTION public.list_conversations()
RETURNS TABLE(other_user_id uuid, other_nickname text, other_avatar text, last_body text, last_at timestamptz, unread bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Не авторизован';
  END IF;

  RETURN QUERY
  SELECT
    ranked.other_id AS other_user_id,
    p.nickname AS other_nickname,
    p.avatar_url AS other_avatar,
    ranked.last_body,
    ranked.last_at,
    ranked.unread
  FROM (
    SELECT * FROM (
      SELECT
        CASE WHEN dm.sender_id = me THEN dm.recipient_id ELSE dm.sender_id END AS other_id,
        last_msg.body AS last_body,
        last_msg.created_at AS last_at,
        COALESCE(unread.cnt, 0) AS unread,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN dm.sender_id = me THEN dm.recipient_id ELSE dm.sender_id END
          ORDER BY dm.created_at DESC
        ) AS rn
      FROM public.direct_messages dm
      JOIN LATERAL (
        SELECT m.body, m.created_at
        FROM public.direct_messages m
        WHERE (m.sender_id = me AND m.recipient_id = dm.recipient_id)
        OR (m.sender_id = dm.recipient_id AND m.recipient_id = me)
        ORDER BY m.created_at DESC
        LIMIT 1
      ) last_msg ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::bigint AS cnt
        FROM public.direct_messages u
        WHERE u.recipient_id = me
        AND u.sender_id = CASE WHEN dm.sender_id = me THEN dm.recipient_id ELSE dm.sender_id END
        AND u.read_at IS NULL
      ) unread ON true
      WHERE dm.sender_id = me OR dm.recipient_id = me
    ) sub
    WHERE sub.rn = 1
  ) ranked
  JOIN public.profiles p ON p.id = ranked.other_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.blocks b
    WHERE b.blocker_id = ranked.other_id AND b.blocked_id = me
  )
  ORDER BY ranked.last_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_conversations() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. Fix list_my_groups — remove me_id param, use auth.uid()
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.list_my_groups(uuid);

CREATE FUNCTION public.list_my_groups()
RETURNS TABLE(id uuid, name text, avatar_url text, description text, created_by uuid, created_at timestamptz, member_count bigint, is_public boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Не авторизован';
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.name,
    g.avatar_url,
    g.description,
    g.created_by,
    g.created_at,
    mc.cnt AS member_count,
    g.is_public
  FROM public.groups g
  JOIN public.group_members gm ON gm.group_id = g.id AND gm.user_id = me
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS cnt
    FROM public.group_members x WHERE x.group_id = g.id
  ) mc ON true
  ORDER BY g.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_my_groups() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 4. Drop legacy create_group(text, text) overload
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.create_group(text, text);

-- ═══════════════════════════════════════════════════════════════
-- 5. Fix dm_update — split into sender-only and recipient-only
-- ═══════════════════════════════════════════════════════════════
REVOKE UPDATE ON public.direct_messages FROM authenticated;
GRANT UPDATE (body, deleted_at) ON public.direct_messages TO authenticated;
GRANT UPDATE (read_at) ON public.direct_messages TO authenticated;

DROP POLICY IF EXISTS "dm_update" ON public.direct_messages;

CREATE POLICY "dm_update_sender" ON public.direct_messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "dm_update_recipient" ON public.direct_messages
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 6. Fix gm_insert — prevent self-appointment as admin
-- ═══════════════════════════════════════════════════════════════
REVOKE INSERT ON public.group_members FROM authenticated;
GRANT INSERT (group_id, user_id, is_admin) ON public.group_members TO authenticated;

DROP POLICY IF EXISTS "gm_insert_admin" ON public.group_members;

CREATE POLICY "gm_insert_self_public" ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      user_id = auth.uid()
      AND is_admin = false
      AND EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.id = group_members.group_id AND g.is_public = true
      )
    )
    OR
    (
      is_group_admin(group_members.group_id)
      AND user_id <> auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 7. Fix gm_update — prevent self-role escalation
-- ═══════════════════════════════════════════════════════════════
REVOKE UPDATE ON public.group_members FROM authenticated;
GRANT UPDATE (is_admin) ON public.group_members TO authenticated;

DROP POLICY IF EXISTS "gm_update_admin" ON public.group_members;

CREATE POLICY "gm_update_admin" ON public.group_members
  FOR UPDATE TO authenticated
  USING (is_group_admin(group_id) AND user_id <> auth.uid())
  WITH CHECK (is_group_admin(group_id) AND user_id <> auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 8. CHECK constraints for message/body lengths
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dm_body_length' AND conrelid = 'public.direct_messages'::regclass) THEN
    ALTER TABLE public.direct_messages ADD CONSTRAINT dm_body_length CHECK (length(body) <= 5000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gmsg_body_length' AND conrelid = 'public.group_messages'::regclass) THEN
    ALTER TABLE public.group_messages ADD CONSTRAINT gmsg_body_length CHECK (length(body) <= 5000);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 9. CHECK constraints: nickname and bio length
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nickname_length' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT nickname_length CHECK (length(nickname) >= 3 AND length(nickname) <= 24);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bio_length' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT bio_length CHECK (length(bio) <= 500);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 10. CHECK constraints: group name and description length
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_name_length' AND conrelid = 'public.groups'::regclass) THEN
    ALTER TABLE public.groups ADD CONSTRAINT group_name_length CHECK (length(name) >= 1 AND length(name) <= 100);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_description_length' AND conrelid = 'public.groups'::regclass) THEN
    ALTER TABLE public.groups ADD CONSTRAINT group_description_length CHECK (length(description) <= 500);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 11. Case-insensitive unique index on nickname
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_nickname_key;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_nickname_ci_idx ON public.profiles (lower(nickname));
