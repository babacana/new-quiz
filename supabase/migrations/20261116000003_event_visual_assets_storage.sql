-- Migração T7: Bucket público e políticas RLS para upload de logotipo e plano de fundo por Evento

INSERT INTO storage.buckets (id, name, public)
VALUES ('event-assets', 'event-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS event_assets_public_read ON storage.objects;
CREATE POLICY event_assets_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'event-assets');

DROP POLICY IF EXISTS event_assets_admin_insert ON storage.objects;
CREATE POLICY event_assets_admin_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'event-assets'
    AND (SELECT public.current_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS event_assets_admin_update ON storage.objects;
CREATE POLICY event_assets_admin_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'event-assets'
    AND (SELECT public.current_user_role()) = 'admin'
  )
  WITH CHECK (
    bucket_id = 'event-assets'
    AND (SELECT public.current_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS event_assets_admin_delete ON storage.objects;
CREATE POLICY event_assets_admin_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'event-assets'
    AND (SELECT public.current_user_role()) = 'admin'
  );
