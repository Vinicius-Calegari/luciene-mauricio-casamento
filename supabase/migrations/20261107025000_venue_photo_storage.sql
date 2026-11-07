-- Public venue images; uploads are restricted to authenticated admin accounts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('venue-photos', 'venue-photos', true, 8388608, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view venue photos" on storage.objects;
create policy "Public can view venue photos"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'venue-photos');

drop policy if exists "Authenticated admins can upload venue photos" on storage.objects;
create policy "Authenticated admins can upload venue photos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'venue-photos');

drop policy if exists "Authenticated admins can update venue photos" on storage.objects;
create policy "Authenticated admins can update venue photos"
on storage.objects for update
to authenticated
using (bucket_id = 'venue-photos')
with check (bucket_id = 'venue-photos');

drop policy if exists "Authenticated admins can delete venue photos" on storage.objects;
create policy "Authenticated admins can delete venue photos"
on storage.objects for delete
to authenticated
using (bucket_id = 'venue-photos');
