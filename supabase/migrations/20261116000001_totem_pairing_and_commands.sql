-- Migração T5: Pareamento de Totens, Telemetria ao Vivo e Fila de Comandos Remotos
-- Baseado em docs/spec.md e docs/adr/0003-pareamento-e-monitoramento-remoto-de-totens.md.

ALTER TABLE public.totems
  ALTER COLUMN device_token DROP NOT NULL;

ALTER TABLE public.totems
  ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_paired boolean NOT NULL DEFAULT false;

-- Remove políticas abertas caso existam e mantém acesso direto à tabela totems restrito à equipe.
DROP POLICY IF EXISTS totems_select_public_pairing ON public.totems;
DROP POLICY IF EXISTS totems_insert_anon_pairing_request ON public.totems;
DROP POLICY IF EXISTS totems_update_anon_telemetry ON public.totems;

-- Fila persistente de comandos remotos enviados pelo Administrador aos Totens
CREATE TABLE IF NOT EXISTS public.totem_commands (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('SWITCH_EVENT', 'FORCE_SYNC', 'RELOAD_SCREEN', 'CONFIG_UPDATED')),
  target_totem_id uuid REFERENCES public.totems(id) ON DELETE CASCADE,
  target_event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  target_screen text CHECK (target_screen IN ('initial-screen', 'idle-screen')),
  config_version integer,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_totem_commands_target_totem
  ON public.totem_commands (target_totem_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_totem_commands_target_event
  ON public.totem_commands (target_event_id, issued_at DESC);

ALTER TABLE public.totem_commands ENABLE ROW LEVEL SECURITY;

-- Políticas para TOTEM_COMMANDS
CREATE POLICY totem_commands_select_public_and_staff
  ON public.totem_commands
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY totem_commands_insert_admin_only
  ON public.totem_commands
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.current_user_role()) = 'admin');

CREATE POLICY totem_commands_delete_admin_only
  ON public.totem_commands
  FOR DELETE
  TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin');

-- RPC segura para o Totem registrar pedido de Pareamento sem expor dados de outros Totens.
CREATE OR REPLACE FUNCTION public.request_totem_pairing(
  p_id uuid,
  p_pairing_code text,
  p_current_screen text,
  p_config_version integer,
  p_pending_sync_count integer
)
RETURNS SETOF public.totems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(p_pairing_code));
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.totems WHERE id = p_id AND is_paired = true
  ) THEN
    RAISE EXCEPTION 'Totem já pareado não pode sobrescrever vínculo via solicitação pública.';
  END IF;

  INSERT INTO public.totems (
    id,
    name,
    pairing_code,
    device_token,
    event_id,
    pin_code,
    is_paired,
    online_status,
    last_seen_at,
    current_screen,
    config_version,
    pending_sync_count
  )
  VALUES (
    p_id,
    'Totem Aguardando Pareamento',
    v_code,
    NULL,
    NULL,
    '0000',
    false,
    'online',
    now(),
    p_current_screen,
    p_config_version,
    p_pending_sync_count
  )
  ON CONFLICT (id) DO UPDATE
    SET pairing_code = EXCLUDED.pairing_code,
        online_status = EXCLUDED.online_status,
        last_seen_at = EXCLUDED.last_seen_at,
        current_screen = EXCLUDED.current_screen,
        config_version = EXCLUDED.config_version,
        pending_sync_count = EXCLUDED.pending_sync_count
  WHERE public.totems.is_paired = false;

  RETURN QUERY SELECT * FROM public.totems WHERE id = p_id;
END;
$$;

-- RPC segura para ativar um Totem via código curto ou link após autorização do Administrador.
CREATE OR REPLACE FUNCTION public.claim_totem_pairing(p_pairing_code text)
RETURNS SETOF public.totems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(p_pairing_code));
BEGIN
  RETURN QUERY
  UPDATE public.totems
     SET online_status = 'online',
         last_seen_at = now()
   WHERE pairing_code = v_code
     AND is_paired = true
     AND event_id IS NOT NULL
  RETURNING *;
END;
$$;

-- RPC autenticada por device_token para publicar telemetria ao vivo sem liberar UPDATE amplo a anon.
CREATE OR REPLACE FUNCTION public.publish_totem_heartbeat(
  p_totem_id uuid,
  p_device_token text,
  p_online_status text,
  p_current_screen text,
  p_config_version integer,
  p_pending_sync_count integer,
  p_seen_at timestamptz DEFAULT now()
)
RETURNS SETOF public.totems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_online_status NOT IN ('online', 'offline') THEN
    RAISE EXCEPTION 'Status online_status inválido: %', p_online_status;
  END IF;

  RETURN QUERY
  UPDATE public.totems
     SET online_status = p_online_status,
         current_screen = p_current_screen,
         config_version = p_config_version,
         pending_sync_count = p_pending_sync_count,
         last_seen_at = CASE
           WHEN p_online_status = 'online' THEN COALESCE(p_seen_at, now())
           ELSE last_seen_at
         END
   WHERE id = p_totem_id
     AND device_token = p_device_token
     AND is_paired = true
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.request_totem_pairing(uuid, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_totem_pairing(uuid, text, text, integer, integer) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_totem_pairing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_totem_pairing(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.publish_totem_heartbeat(uuid, text, text, text, integer, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_totem_heartbeat(uuid, text, text, text, integer, integer, timestamptz) TO anon, authenticated;

-- Publica alterações de Totens e comandos remotos via Supabase Realtime quando disponível.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.totems;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.totem_commands;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
