/*
# Fix direct_messages policies for reliable messaging

## Problems Fixed
1. dm_select_participants: blocked users couldn't see their own sent messages
   - Fix: allow seeing messages where you are sender OR recipient, only filter
     out messages where the OTHER party blocked you (not where you blocked them)
2. dm_insert_own: get_dm_privacy returns NULL for edge cases, blocking all messages
   - Fix: treat NULL dm_privacy as 'all' (the column default)
3. get_dm_privacy: return 'all' as default instead of NULL
*/

-- 1. Fix get_dm_privacy to return 'all' when profile doesn't exist
CREATE OR REPLACE FUNCTION public.get_dm_privacy(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT p.dm_privacy FROM public.profiles p WHERE p.id = p_user_id),
    'all'
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_dm_privacy(uuid) TO authenticated;

-- 2. Fix dm_select_participants: see messages where you're a participant,
--    but hide if the OTHER party blocked you (not if you blocked them)
DROP POLICY IF EXISTS "dm_select_participants" ON public.direct_messages;

CREATE POLICY "dm_select_participants" ON public.direct_messages
  FOR SELECT TO authenticated
  USING (
    (sender_id = auth.uid() OR recipient_id = auth.uid())
    AND NOT has_block(
      CASE WHEN sender_id = auth.uid() THEN recipient_id ELSE sender_id END,
      auth.uid()
    )
  );

-- 3. Simplify dm_insert_own with COALESCE on get_dm_privacy
DROP POLICY IF EXISTS "dm_insert_own" ON public.direct_messages;

CREATE POLICY "dm_insert_own" ON public.direct_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND NOT has_block(recipient_id, auth.uid())
    AND (
      get_dm_privacy(recipient_id) = 'all'
      OR (
        get_dm_privacy(recipient_id) = 'matches'
        AND has_match(auth.uid(), recipient_id)
      )
      OR (
        get_dm_privacy(recipient_id) = 'none'
        AND has_prior_dm(recipient_id, auth.uid())
      )
    )
  );
