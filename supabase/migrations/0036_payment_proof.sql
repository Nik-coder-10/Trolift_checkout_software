-- Payment-proof screenshots: private storage bucket + payments.proof_path.
--
-- Customers upload a screenshot of their UPI payment with the claim.
-- The bucket is private: only the service role (admin client) reads or
-- writes objects, so no storage policies are needed. uploads are
-- size/type limited at the bucket level as defense in depth — the API
-- re-validates by sniffing magic bytes before anything is stored.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

alter table public.payments
  add column if not exists proof_path text;

comment on column public.payments.proof_path is
  'Object path of the customer''s payment screenshot in the payment-proofs bucket (set at claim time).';

commit;
