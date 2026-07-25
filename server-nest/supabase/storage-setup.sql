-- Run once against your Supabase project (SQL editor or `supabase db execute`).
-- Creates the storage bucket used for banners/product images/invoice PDFs
-- and locks it down: public read for media, no public write (writes only
-- via the backend's service-role key, never from a browser).

insert into storage.buckets (id, name, public)
values ('citrine-media', 'citrine-media', true)
on conflict (id) do nothing;

-- Public can read (banners/product images need to render on the customer site).
create policy "Public read access"
  on storage.objects for select
  using (bucket_id = 'citrine-media');

-- No insert/update/delete policy is created for the anon/authenticated roles:
-- all writes go through the NestJS backend using the service_role key, which
-- bypasses RLS entirely by design. This is intentional — it keeps the write
-- path auditable (every upload goes through AuditLog) instead of letting any
-- authenticated client write directly to storage.
