-- Run once in the Supabase SQL Editor after migration 202609290012.
-- Private buckets: only the Edge Function's service role accesses objects.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('portal-packages','portal-packages',false,52428800,array['application/zip'])
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=array['application/zip'];

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('portal-thumbnails','portal-thumbnails',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,
  allowed_mime_types=array['image/png','image/jpeg','image/webp'];
