/*
# Revoke PUBLIC/anon EXECUTE on SECURITY DEFINER functions

## Summary
Several SECURITY DEFINER functions created in migrations 017/018 inherited
default PUBLIC EXECUTE grants, making them callable by the anon role.
This revokes EXECUTE from PUBLIC and anon on all SECURITY DEFINER functions
except check_nickname_available (which needs anon access for registration checks).

## Security Changes
- REVOKE EXECUTE FROM PUBLIC, anon on: list_conversations, list_my_groups,
  list_my_invitations, accept_group_invitation, decline_group_invitation,
  create_group_invitation, list_reports, update_report_status
- check_nickname_available retains anon EXECUTE (needed for registration)
*/

REVOKE EXECUTE ON FUNCTION public.list_conversations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_my_groups() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_my_invitations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_group_invitation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decline_group_invitation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_group_invitation(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_reports(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_report_status(uuid, text, text) FROM PUBLIC, anon;

-- Also clean up older functions that still have PUBLIC execute
REVOKE EXECUTE ON FUNCTION public.is_group_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_group_admin(uuid) FROM PUBLIC, anon;
