-- Do not expose the Storage object listing to anonymous visitors.
-- Event photos are disclosed only in the authorized RSVP response payload.
drop policy if exists "Public can view venue photos" on storage.objects;