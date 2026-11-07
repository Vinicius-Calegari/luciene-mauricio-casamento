-- Track which wedding events each guest is invited to.
-- Existing guests keep the previous behavior: invited to both events.
alter table public.guests
  add column if not exists invited_to_celebration boolean not null default true,
  add column if not exists invited_to_ceremony boolean not null default true;

comment on column public.guests.invited_to_celebration is 'Whether this guest is invited to the celebration.';
comment on column public.guests.invited_to_ceremony is 'Whether this guest is invited to the ceremony.';
