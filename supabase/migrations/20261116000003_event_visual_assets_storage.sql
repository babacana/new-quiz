-- Migração T7: Bucket público e políticas RLS para upload de logotipo e plano de fundo por Evento

INSERT INTO storage.buckets (id, name, public)
VALUES ('quiz_event_assets', 'quiz_event_assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS quiz_event_assets_public_read ON storage.objects;
CREATE POLICY quiz_event_assets_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'quiz_event_assets');

DROP POLICY IF EXISTS quiz_event_assets_admin_insert ON storage.objects;
CREATE POLICY quiz_event_assets_admin_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'quiz_event_assets'
    AND (SELECT public.quiz_current_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS quiz_event_assets_admin_update ON storage.objects;
CREATE POLICY quiz_event_assets_admin_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'quiz_event_assets'
    AND (SELECT public.quiz_current_user_role()) = 'admin'
  )
  WITH CHECK (
    bucket_id = 'quiz_event_assets'
    AND (SELECT public.quiz_current_user_role()) = 'admin'
  );

DROP POLICY IF EXISTS quiz_event_assets_admin_delete ON storage.objects;
CREATE POLICY quiz_event_assets_admin_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'quiz_event_assets'
    AND (SELECT public.quiz_current_user_role()) = 'admin'
  );
