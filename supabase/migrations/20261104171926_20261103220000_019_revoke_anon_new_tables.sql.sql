/*
# Revoke anon grants on new tables
The P1 migration created group_invitations and report_logs but didn't revoke
the default anon grants. RLS blocks access, but the grants should also be
removed for principle of least privilege.
*/
REVOKE ALL ON public.group_invitations FROM anon;
REVOKE ALL ON public.report_logs FROM anon;
