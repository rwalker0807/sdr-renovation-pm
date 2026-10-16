-- Vendor street address and service area (from the Subcontractor Map List).
alter table public.vendors add column address text, add column service_area text;
