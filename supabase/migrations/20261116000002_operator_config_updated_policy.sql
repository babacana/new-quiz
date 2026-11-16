-- Migração T6: Permite que o Operador dispare comandos CONFIG_UPDATED ao confirmar entrega, despremiar ou destravar telefones
-- Mantém UPDATE de events e outros comandos remotos (SWITCH_EVENT, FORCE_SYNC, RELOAD_SCREEN) restritos ao Administrador.

DROP POLICY IF EXISTS totem_commands_insert_admin_only ON public.totem_commands;

CREATE POLICY totem_commands_insert_staff_operational
  ON public.totem_commands
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.current_user_role()) = 'admin'
    OR (
      (SELECT public.current_user_role()) = 'operator'
      AND type = 'CONFIG_UPDATED'
      AND target_event_id IS NOT NULL
    )
  );

-- Publica alterações em Partidas, Brindes e Bloqueios para atualização ao vivo no Painel do Operador.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prize_claims;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.give_up_lockouts;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
