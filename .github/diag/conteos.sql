-- Filas por tabla (solo números, sin datos) y migraciones aplicadas.
select string_agg(format('%s=%s', relname, n_live_tup), ' ' order by relname) as filas from pg_stat_user_tables where schemaname = 'public';
select count(*) as migraciones, max(created_at) as ultima from drizzle.__drizzle_migrations;
-- 0045: claves de ScrapeCreators
