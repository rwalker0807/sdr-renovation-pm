-- National Weather Service zone + county codes per client property, looked up once from api.weather.gov/points
-- when the pin is placed (or moves). Active NWS alerts list the zone/county codes they cover, so the
-- Client Properties map can flag every property under a warning without a per-property call.
alter table public.client_properties
  add column if not exists nws_zone text,          -- forecast zone UGC, e.g. NCZ041
  add column if not exists nws_county text,        -- county UGC, e.g. NCC183
  add column if not exists nws_office text,        -- issuing forecast office, e.g. RAH
  add column if not exists nws_forecast_url text,  -- api.weather.gov forecast for the pin
  add column if not exists nws_point text;         -- "lat,lng" the codes were looked up for
