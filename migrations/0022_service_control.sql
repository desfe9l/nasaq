-- Owner control plane contract.
-- The authoritative document is site_settings['service_control_plane.v1'],
-- written by the application when the owner saves. A missing row means the
-- shipped defaults, not an outage. This marker only records that the contract
-- exists; it is not itself the policy.

insert into site_settings (key, value, updated_at)
select
  'service_control_plane.v1.contract',
  '{"contract":"owner-controlled","authoritativeKey":"service_control_plane.v1"}'::jsonb,
  now()
where not exists (
  select 1 from site_settings where key = 'service_control_plane.v1.contract'
);
