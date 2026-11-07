/*
# Fix orphaned groups (created but creator not added as member)
# Also add transaction wrapping to create_group to prevent future orphans
*/

-- 1. Fix existing orphaned groups: add creator as admin member
INSERT INTO public.group_members (group_id, user_id, is_admin)
SELECT g.id, g.created_by, true
FROM public.groups g
WHERE NOT EXISTS (
  SELECT 1 FROM public.group_members gm WHERE gm.group_id = g.id AND gm.user_id = g.created_by
)
ON CONFLICT (group_id, user_id) DO NOTHING;

-- 2. Recreate create_group with explicit error handling
CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_description text, p_is_public boolean DEFAULT true)
RETURNS public.groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_group public.groups%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Не авторизован';
  END IF;
  IF btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Введите название группы';
  END IF;

  INSERT INTO public.groups (name, description, created_by, is_public)
  VALUES (btrim(p_name), btrim(COALESCE(p_description, '')), v_user, COALESCE(p_is_public, true))
  RETURNING * INTO v_group;

  INSERT INTO public.group_members (group_id, user_id, is_admin)
  VALUES (v_group.id, v_user, true);

  RETURN v_group;
END;
$function$;
