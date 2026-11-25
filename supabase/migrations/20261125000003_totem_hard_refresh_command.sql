-- Novo comando remoto HARD_REFRESH: recarrega a página inteira do Totem (equivale a Ctrl+Shift+R)
-- para o dispositivo baixar a versão mais recente publicada.
DO $$
DECLARE
  v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.quiz_totem_commands'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%RELOAD_SCREEN%'
  LOOP
    EXECUTE format('ALTER TABLE public.quiz_totem_commands DROP CONSTRAINT %I', v_constraint);
  END LOOP;
END $$;

ALTER TABLE public.quiz_totem_commands
  ADD CONSTRAINT quiz_totem_commands_type_check
  CHECK (type IN ('SWITCH_EVENT', 'FORCE_SYNC', 'RELOAD_SCREEN', 'CONFIG_UPDATED', 'HARD_REFRESH'));
