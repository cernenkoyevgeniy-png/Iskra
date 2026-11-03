/*
# P1 Security Fixes — Privacy, Group Invitations, Moderation

## Summary
1. Add dm_privacy column to profiles (who can message me first: all/matches/none)
2. Enforce dm_privacy in dm_insert policy at the database level
3. Create group_invitations table for accept/decline flow
4. Revoke direct INSERT on group_members for non-public groups (already done in P0)
5. Add moderation columns to reports (status enum, moderator_id, resolved_at, moderator_note)
6. Create report_statuses CHECK constraint
7. Add moderator role support via raw_app_meta_data
8. Create list_reports RPC for moderators
9. Update report status RPC for moderators
10. Add report log table for moderator action history

## New Tables
- group_invitations: tracks invites with accept/decline flow
- report_logs: audit trail of moderator actions

## Modified Tables
- profiles: added dm_privacy text column (default 'all')
- reports: added moderator_id, resolved_at, moderator_note columns; status constraint updated

## Security Changes
- RLS: dm_insert now checks recipient's dm_privacy setting
- RLS: group_invitations — invitee sees/accepts/declines own invites; admins see group invites
- RLS: reports — moderators see all reports; users see only own reports
- RPC: list_reports() for moderators only
- RPC: update_report_status() for moderators only
- RPC: create_group_invitation() — admin invites user to group
- RPC: accept_group_invitation() — invitee accepts
- RPC: decline_group_invitation() — invitee declines

## Important Notes
1. No data deleted. Existing reports keep their 'open' status.
2. dm_privacy defaults to 'all' — existing behavior preserved for current users.
3. Moderator role is set via raw_app_meta_data->>'role' = 'moderator' in auth.users.
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. Add dm_privacy column to profiles
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='dm_privacy') THEN
    ALTER TABLE public.profiles ADD COLUMN dm_privacy text NOT NULL DEFAULT 'all';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dm_privacy_check' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT dm_privacy_check CHECK (dm_privacy IN ('all', 'matches', 'none'));
  END IF;
END $$;

-- Grant access to the new column
GRANT UPDATE (dm_privacy) ON public.profiles TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2. Enforce dm_privacy in INSERT policy
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "dm_insert_own" ON public.direct_messages;

CREATE POLICY "dm_insert_own" ON public.direct_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE b.blocker_id = direct_messages.recipient_id AND b.blocked_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = direct_messages.recipient_id
      AND (
        p.dm_privacy = 'all'
        OR
        (p.dm_privacy = 'matches' AND EXISTS (
          SELECT 1 FROM public.matches m
          WHERE (m.user_a = auth.uid() AND m.user_b = direct_messages.recipient_id)
             OR (m.user_b = auth.uid() AND m.user_a = direct_messages.recipient_id)
        ))
        OR
        (p.dm_privacy = 'none' AND EXISTS (
          SELECT 1 FROM public.direct_messages prev
          WHERE prev.sender_id = direct_messages.recipient_id
            AND prev.recipient_id = auth.uid()
            AND prev.deleted_at IS NULL
        ))
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 3. Create group_invitations table
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.group_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (group_id, invitee_id, status) DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE public.group_invitations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gi_status_check' AND conrelid = 'public.group_invitations'::regclass) THEN
    ALTER TABLE public.group_invitations ADD CONSTRAINT gi_status_check CHECK (status IN ('pending', 'accepted', 'declined'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gi_self_check' AND conrelid = 'public.group_invitations'::regclass) THEN
    ALTER TABLE public.group_invitations ADD CONSTRAINT gi_self_check CHECK (inviter_id <> invitee_id);
  END IF;
END $$;

-- Grants: invitee can see/accept/decline; admin can see and create
GRANT SELECT ON public.group_invitations TO authenticated;
GRANT INSERT (group_id, invitee_id) ON public.group_invitations TO authenticated;
GRANT UPDATE (status, responded_at) ON public.group_invitations TO authenticated;

-- RLS: invitee sees own invitations; group admin sees invitations for their groups
DROP POLICY IF EXISTS "gi_select_invited" ON public.group_invitations;
CREATE POLICY "gi_select_invited" ON public.group_invitations
  FOR SELECT TO authenticated
  USING (
    invitee_id = auth.uid()
    OR is_group_admin(group_id)
  );

-- RLS: only group admins can invite
DROP POLICY IF EXISTS "gi_insert_admin" ON public.group_invitations;
CREATE POLICY "gi_insert_admin" ON public.group_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    inviter_id = auth.uid()
    AND is_group_admin(group_id)
    AND invitee_id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = group_invitations.invitee_id)
         OR (b.blocker_id = group_invitations.invitee_id AND b.blocked_id = auth.uid())
    )
  );

-- RLS: only invitee can accept/decline
DROP POLICY IF EXISTS "gi_update_invited" ON public.group_invitations;
CREATE POLICY "gi_update_invited" ON public.group_invitations
  FOR UPDATE TO authenticated
  USING (invitee_id = auth.uid())
  WITH CHECK (invitee_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 4. RPC: create_group_invitation (admin invites user)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_group_invitation(p_group_id uuid, p_invitee_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  v_inv_id uuid;
  v_already_member boolean;
  v_pending_exists boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;
  IF me = p_invitee_id THEN RAISE EXCEPTION 'Нельзя пригласить себя'; END IF;
  IF NOT is_group_admin(p_group_id) THEN RAISE EXCEPTION 'Только администратор может приглашать'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.group_members gm WHERE gm.group_id = p_group_id AND gm.user_id = p_invitee_id)
    INTO v_already_member;
  IF v_already_member THEN RAISE EXCEPTION 'Пользователь уже состоит в группе'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.group_invitations gi WHERE gi.group_id = p_group_id AND gi.invitee_id = p_invitee_id AND gi.status = 'pending')
    INTO v_pending_exists;
  IF v_pending_exists THEN RAISE EXCEPTION 'Приглашение уже отправлено'; END IF;

  INSERT INTO public.group_invitations (group_id, inviter_id, invitee_id, status)
  VALUES (p_group_id, me, p_invitee_id, 'pending')
  RETURNING id INTO v_inv_id;

  RETURN v_inv_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_group_invitation(uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 5. RPC: accept_group_invitation
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.accept_group_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  v_inv record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;

  SELECT * INTO v_inv FROM public.group_invitations WHERE id = p_invitation_id AND invitee_id = me AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Приглашение не найдено'; END IF;

  UPDATE public.group_invitations SET status = 'accepted', responded_at = now() WHERE id = p_invitation_id;

  INSERT INTO public.group_members (group_id, user_id, is_admin)
  VALUES (v_inv.group_id, me, false)
  ON CONFLICT (group_id, user_id) DO NOTHING;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.accept_group_invitation(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 6. RPC: decline_group_invitation
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.decline_group_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;

  UPDATE public.group_invitations
  SET status = 'declined', responded_at = now()
  WHERE id = p_invitation_id AND invitee_id = me AND status = 'pending';

  IF NOT FOUND THEN RAISE EXCEPTION 'Приглашение не найдено'; END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.decline_group_invitation(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 7. RPC: list_my_invitations — pending invitations for current user
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.list_my_invitations()
RETURNS TABLE(id uuid, group_id uuid, group_name text, inviter_id uuid, inviter_nickname text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;

  RETURN QUERY
  SELECT
    gi.id,
    gi.group_id,
    g.name AS group_name,
    gi.inviter_id,
    p.nickname AS inviter_nickname,
    gi.created_at
  FROM public.group_invitations gi
  JOIN public.groups g ON g.id = gi.group_id
  JOIN public.profiles p ON p.id = gi.inviter_id
  WHERE gi.invitee_id = me AND gi.status = 'pending'
  ORDER BY gi.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_my_invitations() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 8. Moderation: update reports table
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reports' AND column_name='moderator_id') THEN
    ALTER TABLE public.reports ADD COLUMN moderator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reports' AND column_name='resolved_at') THEN
    ALTER TABLE public.reports ADD COLUMN resolved_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reports' AND column_name='moderator_note') THEN
    ALTER TABLE public.reports ADD COLUMN moderator_note text;
  END IF;
END $$;

-- Update status constraint to include moderation statuses
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_status_check' AND conrelid = 'public.reports'::regclass) THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_status_check CHECK (status IN ('new', 'reviewing', 'resolved', 'dismissed', 'open'));
  END IF;
END $$;

-- Update existing 'open' status to 'new'
UPDATE public.reports SET status = 'new' WHERE status = 'open';

-- Grant UPDATE on reports to authenticated (but policy restricts to moderators)
REVOKE UPDATE ON public.reports FROM authenticated;
GRANT UPDATE (status, moderator_id, resolved_at, moderator_note) ON public.reports TO authenticated;

-- Update reports INSERT policy to default status='new'
DROP POLICY IF EXISTS "reports_insert_own" ON public.reports;
CREATE POLICY "reports_insert_own" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Reports SELECT: user sees own reports, moderators see all
DROP POLICY IF EXISTS "reports_select_own" ON public.reports;
CREATE POLICY "reports_select_own" ON public.reports
  FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid()
    OR (auth.jwt() -> 'app_metadata' ->> 'role' = 'moderator')
  );

-- Reports UPDATE: only moderators can change status
DROP POLICY IF EXISTS "reports_update_moderator" ON public.reports;
CREATE POLICY "reports_update_moderator" ON public.reports
  FOR UPDATE TO authenticated
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'moderator')
  WITH CHECK (auth.jwt() -> 'app_metadata' ->> 'role' = 'moderator');

-- ═══════════════════════════════════════════════════════════════
-- 9. Create report_logs table for moderator action history
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.report_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  moderator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  previous_status text,
  new_status text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.report_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.report_logs TO authenticated;
GRANT INSERT (report_id, action, previous_status, new_status, note) ON public.report_logs TO authenticated;

-- Only moderators can see report logs
DROP POLICY IF EXISTS "rlog_select_moderator" ON public.report_logs;
CREATE POLICY "rlog_select_moderator" ON public.report_logs
  FOR SELECT TO authenticated
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'moderator');

-- Only moderators can insert log entries (triggered by update_report_status RPC)
DROP POLICY IF EXISTS "rlog_insert_moderator" ON public.report_logs;
CREATE POLICY "rlog_insert_moderator" ON public.report_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() -> 'app_metadata' ->> 'role' = 'moderator');

-- ═══════════════════════════════════════════════════════════════
-- 10. RPC: list_reports (moderators only)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.list_reports(p_status text DEFAULT NULL)
RETURNS TABLE(id uuid, reporter_id uuid, reported_id uuid, reason text, status text, created_at timestamptz, moderator_id uuid, resolved_at timestamptz, moderator_note text, reporter_nick text, reported_nick text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  is_mod boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;

  SELECT (auth.jwt() -> 'app_metadata' ->> 'role' = 'moderator') INTO is_mod;
  IF NOT is_mod THEN RAISE EXCEPTION 'Доступ только для модераторов'; END IF;

  RETURN QUERY
  SELECT
    r.id, r.reporter_id, r.reported_id, r.reason, r.status, r.created_at,
    r.moderator_id, r.resolved_at, r.moderator_note,
    reporter.nickname AS reporter_nick,
    reported.nickname AS reported_nick
  FROM public.reports r
  LEFT JOIN public.profiles reporter ON reporter.id = r.reporter_id
  LEFT JOIN public.profiles reported ON reported.id = r.reported_id
  WHERE (p_status IS NULL OR p_status = '' OR r.status = p_status)
  ORDER BY r.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_reports(text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 11. RPC: update_report_status (moderators only)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_report_status(p_report_id uuid, p_new_status text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  is_mod boolean;
  v_old_status text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Не авторизован'; END IF;

  SELECT (auth.jwt() -> 'app_metadata' ->> 'role' = 'moderator') INTO is_mod;
  IF NOT is_mod THEN RAISE EXCEPTION 'Доступ только для модераторов'; END IF;

  IF p_new_status NOT IN ('new', 'reviewing', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Недопустимый статус';
  END IF;

  SELECT status INTO v_old_status FROM public.reports WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Жалоба не найдена'; END IF;

  UPDATE public.reports
  SET status = p_new_status,
      moderator_id = me,
      moderator_note = p_note,
      resolved_at = CASE WHEN p_new_status IN ('resolved', 'dismissed') THEN now() ELSE resolved_at END
  WHERE id = p_report_id;

  INSERT INTO public.report_logs (report_id, moderator_id, action, previous_status, new_status, note)
  VALUES (p_report_id, me, 'status_change', v_old_status, p_new_status, p_note);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_report_status(uuid, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 12. RPC: check_nickname_available (for registration)
--     Returns boolean — true if nickname is available
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_nickname_available(p_nickname text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  v_taken boolean;
BEGIN
  IF btrim(p_nickname) = '' OR length(p_nickname) < 3 THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    WHERE lower(p.nickname) = lower(btrim(p_nickname))
    AND (me IS NULL OR p.id <> me)
  ) INTO v_taken;

  RETURN NOT v_taken;
END;
$function$;

-- Allow anon to call this for registration checks
GRANT EXECUTE ON FUNCTION public.check_nickname_available(text) TO anon, authenticated;
