-- Publicly downloadable wedding invitation files; only authenticated admins can upload or manage them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wedding-invitations', 'wedding-invitations', true, 15728640, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 15728640, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated admins can upload wedding invitations" on storage.objects;
create policy "Authenticated admins can upload wedding invitations"
on storage.objects for insert to authenticated
with check (bucket_id = 'wedding-invitations');

drop policy if exists "Authenticated admins can update wedding invitations" on storage.objects;
create policy "Authenticated admins can update wedding invitations"
on storage.objects for update to authenticated
using (bucket_id = 'wedding-invitations') with check (bucket_id = 'wedding-invitations');

drop policy if exists "Authenticated admins can delete wedding invitations" on storage.objects;
create policy "Authenticated admins can delete wedding invitations"
on storage.objects for delete to authenticated
using (bucket_id = 'wedding-invitations');
