-- Migração T10: endurecimento de segurança identificado na revisão de 2026-11-23.
-- IMPORTANTE: o banco de produção (projeto compartilhado PRCE) tem migrações aplicadas à mão;
-- revisar e aplicar via Supabase CLI/painel somente após confirmação do responsável.

-- ============================================================
-- S3: funções de estoque/revogação só podem ser chamadas pelas RPCs do Totem (SECURITY DEFINER).
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.quiz_consume_event_prize_stock(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.quiz_revoke_exhausted_prize_claim(uuid) FROM anon, authenticated, PUBLIC;

-- ============================================================
-- S4: código de Pareamento de uso único (com janela curta para repetir a ativação).
-- ============================================================
ALTER TABLE public.quiz_totems
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- Reabre a ativação quando o Administrador (re)autoriza o Pareamento ou troca o código.
CREATE OR REPLACE FUNCTION public.quiz_totems_reset_claim()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (OLD.is_paired = false AND NEW.is_paired = true)
     OR NEW.pairing_code IS DISTINCT FROM OLD.pairing_code
     OR NEW.device_token IS DISTINCT FROM OLD.device_token THEN
    NEW.claimed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quiz_totems_reset_claim ON public.quiz_totems;
CREATE TRIGGER quiz_totems_reset_claim
  BEFORE UPDATE ON public.quiz_totems
  FOR EACH ROW EXECUTE FUNCTION public.quiz_totems_reset_claim();

CREATE OR REPLACE FUNCTION public.quiz_claim_totem_pairing(p_pairing_code text)
RETURNS SETOF public.quiz_totems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(p_pairing_code));
BEGIN
  RETURN QUERY
  UPDATE public.quiz_totems
     SET online_status = 'online',
         last_seen_at = now(),
         claimed_at = COALESCE(claimed_at, now())
   WHERE pairing_code = v_code
     AND is_paired = true
     AND event_id IS NOT NULL
     AND (claimed_at IS NULL OR claimed_at > now() - interval '10 minutes')
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_claim_totem_pairing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_claim_totem_pairing(text) TO anon, authenticated;

-- ============================================================
-- S6: validação de limites das Partidas enviadas pelo Totem.
-- A função original é preservada como implementação interna e deixa de ser exposta.
-- ============================================================
ALTER FUNCTION public.quiz_totem_push_match(uuid, text, jsonb, jsonb)
  RENAME TO quiz_totem_push_match_unchecked;
REVOKE ALL ON FUNCTION public.quiz_totem_push_match_unchecked(uuid, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.quiz_totem_push_match(
  p_totem_id uuid,
  p_device_token text,
  p_match jsonb,
  p_prize_claim jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_score integer;
  v_total integer;
  v_time integer;
BEGIN
  IF p_totem_id IS NULL OR NULLIF(trim(COALESCE(p_device_token, '')), '') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.quiz_totems
        WHERE id = p_totem_id AND device_token = p_device_token AND is_paired = true
     ) THEN
    RAISE EXCEPTION 'Totem não autorizado ou device_token inválido.' USING ERRCODE = '42501';
  END IF;

  IF p_match IS NULL OR jsonb_typeof(p_match) <> 'object' THEN
    RAISE EXCEPTION 'Partida inválida.' USING ERRCODE = '22023';
  END IF;

  v_score := (p_match->>'score')::integer;
  v_total := (p_match->>'totalQuestions')::integer;
  v_time := (p_match->>'timeSeconds')::integer;

  IF v_total IS NULL OR v_total < 1 OR v_total > 100
     OR v_score IS NULL OR v_score < 0 OR v_score > v_total
     OR v_time IS NULL OR v_time < 0 OR v_time > 86400 THEN
    RAISE EXCEPTION 'Placar ou tempo da Partida fora dos limites.' USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(p_match->>'participantName', '')) > 200
     OR char_length(COALESCE(p_match->>'participantPhone', '')) > 32 THEN
    RAISE EXCEPTION 'Dados do Participante fora dos limites.' USING ERRCODE = '22023';
  END IF;

  RETURN public.quiz_totem_push_match_unchecked(p_totem_id, p_device_token, p_match, p_prize_claim);
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_totem_push_match(uuid, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_totem_push_match(uuid, text, jsonb, jsonb) TO anon, authenticated;

-- ============================================================
-- S7: gabarito do Banco de Questões deixa de ser legível por anon (o Totem usa o snapshot via RPC).
-- ============================================================
DROP POLICY IF EXISTS quiz_questions_select_public_and_staff ON public.quiz_questions;
CREATE POLICY quiz_questions_select_staff_only
  ON public.quiz_questions
  FOR SELECT
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

DROP POLICY IF EXISTS quiz_event_questions_select_public_and_staff ON public.quiz_event_questions;
CREATE POLICY quiz_event_questions_select_staff_only
  ON public.quiz_event_questions
  FOR SELECT
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

-- ============================================================
-- B1: substituição do Banco de Questões atômica, preservando vínculos Evento-Questão por texto.
-- ============================================================
CREATE OR REPLACE FUNCTION public.quiz_replace_all_questions(p_questions jsonb)
RETURNS SETOF public.quiz_questions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT public.quiz_current_user_role()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas Administradores podem substituir o Banco de Questões.' USING ERRCODE = '42501';
  END IF;

  CREATE TEMP TABLE quiz_old_event_links ON COMMIT DROP AS
    SELECT eq.event_id, lower(btrim(q.text)) AS text_key
      FROM public.quiz_event_questions eq
      JOIN public.quiz_questions q ON q.id = eq.question_id;

  DELETE FROM public.quiz_questions WHERE true;

  INSERT INTO public.quiz_questions (id, text, options, correct_index, difficulty, tags, is_disabled)
  SELECT (e->>'id')::bigint,
         e->>'text',
         e->'options',
         (e->>'correct_index')::smallint,
         e->>'difficulty',
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(e->'tags', '[]'::jsonb))), '{}'),
         COALESCE((e->>'is_disabled')::boolean, false)
    FROM jsonb_array_elements(COALESCE(p_questions, '[]'::jsonb)) AS e;

  INSERT INTO public.quiz_event_questions (event_id, question_id)
  SELECT DISTINCT l.event_id, q.id
    FROM quiz_old_event_links l
    JOIN public.quiz_questions q ON lower(btrim(q.text)) = l.text_key
  ON CONFLICT DO NOTHING;

  PERFORM setval(
    pg_get_serial_sequence('public.quiz_questions', 'id'),
    GREATEST(COALESCE((SELECT max(id) FROM public.quiz_questions), 0), 1)
  );

  RETURN QUERY SELECT * FROM public.quiz_questions ORDER BY id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_replace_all_questions(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quiz_replace_all_questions(jsonb) TO authenticated;

-- ============================================================
-- Performance (advisor do Supabase): índices de chaves estrangeiras e initplan em quiz_profiles.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_quiz_event_questions_question_id ON public.quiz_event_questions (question_id);
CREATE INDEX IF NOT EXISTS idx_quiz_give_up_lockouts_totem_id ON public.quiz_give_up_lockouts (totem_id);
CREATE INDEX IF NOT EXISTS idx_quiz_give_up_lockouts_unlocked_by ON public.quiz_give_up_lockouts (unlocked_by);
CREATE INDEX IF NOT EXISTS idx_quiz_matches_totem_id ON public.quiz_matches (totem_id);
CREATE INDEX IF NOT EXISTS idx_quiz_prize_claims_delivered_by ON public.quiz_prize_claims (delivered_by);
CREATE INDEX IF NOT EXISTS idx_quiz_prize_claims_match_id ON public.quiz_prize_claims (match_id);
CREATE INDEX IF NOT EXISTS idx_quiz_prize_claims_totem_id ON public.quiz_prize_claims (totem_id);
CREATE INDEX IF NOT EXISTS idx_quiz_totem_commands_event_id ON public.quiz_totem_commands (event_id);
CREATE INDEX IF NOT EXISTS idx_quiz_totems_event_id ON public.quiz_totems (event_id);

DROP POLICY IF EXISTS quiz_profiles_select_self_or_admin ON public.quiz_profiles;
CREATE POLICY quiz_profiles_select_self_or_admin
  ON public.quiz_profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.quiz_current_user_role()) = 'admin');
