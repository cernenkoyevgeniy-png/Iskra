/*
# Fix RLS policy subqueries broken by nested RLS

## Root Cause
RLS policies run with the invoker's permissions. Subqueries inside policies
on `blocks` and `profiles` are themselves subject to RLS:
- blocks_select_own: only blocker_id = auth.uid() visible → can't check if
  the OTHER user blocked you
- profiles_select_visible: now filters hidden_from_search=true → can't check
  recipient's dm_privacy for hidden users

## Fix
1. Create has_block() SECURITY DEFINER helper — checks blocks bypassing RLS
2. Create get_dm_privacy() SECURITY DEFINER helper — returns dm_privacy bypassing RLS
3. Update dm_insert_own to use these helpers
4. Update profiles_select_visible to use has_block() for block check
5. Update gi_insert_admin to use has_block() for block check
6. Update dm_select_participants to use has_block()

## No data changes. No table structure changes. Only policy + function definitions.
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. SECURITY DEFINER helpers (bypass RLS for cross-user checks)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.has_block(p_blocker uuid, p_blocked uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.blocks b
    WHERE b.blocker_id = p_blocker AND b.blocked_id = p_blocked
  );
$function$;

GRANT EXECUTE ON FUNCTION public.has_block(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_dm_privacy(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.dm_privacy FROM public.profiles p WHERE p.id = p_user_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_dm_privacy(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_match(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.matches m
    WHERE (m.user_a = p_user_a AND m.user_b = p_user_b)
       OR (m.user_a = p_user_b AND m.user_b = p_user_a)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.has_match(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_prior_dm(p_user_a uuid, p_user_b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.direct_messages d
    WHERE d.sender_id = p_user_a AND d.recipient_id = p_user_b
      AND d.deleted_at IS NULL
  );
$function$;

GRANT EXECUTE ON FUNCTION public.has_prior_dm(uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2. Fix dm_insert_own — use helpers instead of RLS-blocked subqueries
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "dm_insert_own" ON public.direct_messages;

CREATE POLICY "dm_insert_own" ON public.direct_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND NOT public.has_block(direct_messages.recipient_id, auth.uid())
    AND (
      public.get_dm_privacy(direct_messages.recipient_id) = 'all'
      OR (
        public.get_dm_privacy(direct_messages.recipient_id) = 'matches'
        AND public.has_match(auth.uid(), direct_messages.recipient_id)
      )
      OR (
        public.get_dm_privacy(direct_messages.recipient_id) = 'none'
        AND public.has_prior_dm(direct_messages.recipient_id, auth.uid())
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 3. Fix dm_select_participants — use has_block helper
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "dm_select_participants" ON public.direct_messages;

CREATE POLICY "dm_select_participants" ON public.direct_messages
  FOR SELECT TO authenticated
  USING (
    (sender_id = auth.uid() OR recipient_id = auth.uid())
    AND NOT public.has_block(auth.uid(), sender_id)
    AND NOT public.has_block(auth.uid(), recipient_id)
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. Fix profiles_select_visible — use has_block helper
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "profiles_select_visible" ON public.profiles;

CREATE POLICY "profiles_select_visible" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      hidden_from_search = false
      AND NOT public.has_block(id, auth.uid())
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 5. Fix gi_insert_admin — use has_block helper
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "gi_insert_admin" ON public.group_invitations;

CREATE POLICY "gi_insert_admin" ON public.group_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    inviter_id = auth.uid()
    AND is_group_admin(group_id)
    AND invitee_id <> auth.uid()
    AND NOT public.has_block(auth.uid(), group_invitations.invitee_id)
    AND NOT public.has_block(group_invitations.invitee_id, auth.uid())
  );
