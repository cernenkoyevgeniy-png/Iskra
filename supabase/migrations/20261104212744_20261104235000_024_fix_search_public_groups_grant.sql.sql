/*
# Fix search_public_groups EXECUTE grant

search_public_groups was recreated in migration 021 (DROP + CREATE) and 
inherited default PUBLIC execute grant. Revoke from PUBLIC and anon.
*/
REVOKE EXECUTE ON FUNCTION public.search_public_groups(text, integer) FROM PUBLIC, anon;
