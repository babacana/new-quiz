-- Migração T9: Blindagem RLS, Borda RPC Autenticada por device_token e Proteção LGPD no Totem
-- Baseado em docs/adr/0007-borda-rpc-autenticada-por-device-token-e-rls-lgpd.md.
-- IMPORTANTE: Não executar automaticamente em produção neste passo; aplicar via pipeline/Supabase CLI.

-- Extensão necessária para digest SHA-256 determinístico compatível com o cliente.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Função determinística de hash SHA-256 por Evento e dígitos numéricos do telefone (LGPD).
-- Formato de entrada: "<event_id>::<somente_digitos_telefone>" em UTF-8.
CREATE OR REPLACE FUNCTION public.quiz_hash_event_phone(p_event_id uuid, p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        p_event_id::text || '::' || regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.quiz_hash_event_phone(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_hash_event_phone(uuid, text) TO authenticated;

-- Índice auxiliar para recuperar comandos remotos por janela temporal durante reconciliação do Totem.
CREATE INDEX IF NOT EXISTS idx_quiz_totem_commands_issued_at
  ON public.quiz_totem_commands (issued_at ASC);

-- ============================================================
-- Remoção de políticas anônimas permissivas (LGPD e integridade)
-- ============================================================
DROP POLICY IF EXISTS quiz_matches_select_public_and_staff ON public.quiz_matches;
DROP POLICY IF EXISTS quiz_matches_insert_totem_and_admin ON public.quiz_matches;

CREATE POLICY quiz_matches_select_staff_only
  ON public.quiz_matches
  FOR SELECT
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

CREATE POLICY quiz_matches_insert_admin_only
  ON public.quiz_matches
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

DROP POLICY IF EXISTS quiz_prize_claims_select_public_and_staff ON public.quiz_prize_claims;
DROP POLICY IF EXISTS quiz_prize_claims_insert_totem_and_staff ON public.quiz_prize_claims;

CREATE POLICY quiz_prize_claims_select_staff_only
  ON public.quiz_prize_claims
  FOR SELECT
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

CREATE POLICY quiz_prize_claims_insert_admin_only
  ON public.quiz_prize_claims
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

DROP POLICY IF EXISTS quiz_give_up_lockouts_select_public_and_staff ON public.quiz_give_up_lockouts;
DROP POLICY IF EXISTS quiz_give_up_lockouts_insert_totem_and_staff ON public.quiz_give_up_lockouts;

CREATE POLICY quiz_give_up_lockouts_select_staff_only
  ON public.quiz_give_up_lockouts
  FOR SELECT
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

CREATE POLICY quiz_give_up_lockouts_insert_admin_only
  ON public.quiz_give_up_lockouts
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

DROP POLICY IF EXISTS quiz_totem_commands_select_public_and_staff ON public.quiz_totem_commands;

CREATE POLICY quiz_totem_commands_select_staff_only
  ON public.quiz_totem_commands
  FOR SELECT
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

-- Restringe execução direta das funções auxiliares de estoque apenas a chamadores autenticados/internos.
REVOKE EXECUTE ON FUNCTION public.quiz_consume_event_prize_stock(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_consume_event_prize_stock(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.quiz_revoke_exhausted_prize_claim(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_revoke_exhausted_prize_claim(uuid) TO authenticated;

-- ============================================================
-- Borda RPC autenticada por (totem_id, device_token) para o Totem
-- ============================================================

-- Baixa snapshot enxuto e seguro para LGPD do Evento ativo no Totem pareado.
-- Omite participant_phone e answers das Partidas; converte telefones de Travas e Bloqueios em SHA-256.
CREATE OR REPLACE FUNCTION public.quiz_totem_pull_event_snapshot(
  p_totem_id uuid,
  p_device_token text,
  p_event_id uuid,
  p_commands_since timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event record;
  v_has_explicit_links boolean := false;
  v_questions jsonb;
  v_ranking_matches jsonb;
  v_prize_locks jsonb;
  v_lockouts jsonb;
  v_pending_commands jsonb;
BEGIN
  IF p_totem_id IS NULL OR NULLIF(trim(COALESCE(p_device_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Credenciais do Totem são obrigatórias.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.quiz_totems
     WHERE id = p_totem_id
       AND device_token = p_device_token
       AND is_paired = true
  ) THEN
    RAISE EXCEPTION 'Totem não autorizado ou device_token inválido.' USING ERRCODE = '42501';
  END IF;

  SELECT id,
         name,
         slug,
         start_time,
         end_time,
         enable_out_of_period_message,
         is_active,
         settings,
         prize_stock_remaining,
         customizations,
         config_version
    INTO v_event
    FROM public.quiz_events
   WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.quiz_event_questions WHERE event_id = p_event_id
  ) INTO v_has_explicit_links;

  IF v_has_explicit_links THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'text', q.text,
          'options', q.options,
          'correct_index', q.correct_index,
          'difficulty', q.difficulty,
          'tags', q.tags,
          'is_disabled', q.is_disabled
        )
        ORDER BY q.id ASC
      ),
      '[]'::jsonb
    )
    INTO v_questions
    FROM public.quiz_questions q
    INNER JOIN public.quiz_event_questions eq
            ON eq.question_id = q.id
           AND eq.event_id = p_event_id;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'text', q.text,
          'options', q.options,
          'correct_index', q.correct_index,
          'difficulty', q.difficulty,
          'tags', q.tags,
          'is_disabled', q.is_disabled
        )
        ORDER BY q.id ASC
      ),
      '[]'::jsonb
    )
    INTO v_questions
    FROM public.quiz_questions q;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'event_id', m.event_id,
        'totem_id', m.totem_id,
        'participant_name', m.participant_name,
        'score', m.score,
        'total_questions', m.total_questions,
        'time_seconds', m.time_seconds,
        'played_at', m.played_at,
        'synced_at', m.synced_at
      )
      ORDER BY m.score DESC, m.time_seconds ASC, m.played_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_ranking_matches
  FROM public.quiz_matches m
  WHERE m.event_id = p_event_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'event_id', c.event_id,
        'match_id', c.match_id,
        'phone_hash', public.quiz_hash_event_phone(c.event_id, c.participant_phone),
        'status', c.status,
        'awarded_at', c.created_at,
        'delivered_at', c.delivered_at
      )
    ),
    '[]'::jsonb
  )
  INTO v_prize_locks
  FROM public.quiz_prize_claims c
  WHERE c.event_id = p_event_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'event_id', l.event_id,
        'phone_hash', public.quiz_hash_event_phone(l.event_id, l.participant_phone),
        'locked_at', l.locked_at,
        'expires_at', l.expires_at
      )
    ),
    '[]'::jsonb
  )
  INTO v_lockouts
  FROM public.quiz_give_up_lockouts l
  WHERE l.event_id = p_event_id;

  IF p_commands_since IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', cmd.id,
          'type', cmd.type,
          'target_totem_id', cmd.target_totem_id,
          'target_event_id', cmd.target_event_id,
          'event_id', cmd.event_id,
          'target_screen', cmd.target_screen,
          'config_version', cmd.config_version,
          'issued_at', cmd.issued_at
        )
        ORDER BY cmd.issued_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_pending_commands
    FROM public.quiz_totem_commands cmd
    WHERE cmd.issued_at >= p_commands_since
      AND (cmd.target_totem_id = p_totem_id OR cmd.target_event_id = p_event_id);
  ELSE
    v_pending_commands := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'slug', v_event.slug,
      'start_time', v_event.start_time,
      'end_time', v_event.end_time,
      'enable_out_of_period_message', v_event.enable_out_of_period_message,
      'is_active', v_event.is_active,
      'settings', v_event.settings,
      'prize_stock_remaining', v_event.prize_stock_remaining,
      'customizations', v_event.customizations,
      'config_version', v_event.config_version
    ),
    'questions', v_questions,
    'rankingMatches', v_ranking_matches,
    'prizeLocks', v_prize_locks,
    'lockouts', v_lockouts,
    'pendingCommands', v_pending_commands
  );
END;
$$;

-- Sincroniza atomicamente uma Partida e seu possível Brinde em uma única viagem RPC.
-- Trata idempotência de reenvio, conflito offline (23505 -> offline_duplicate_conflict) e consumo de estoque.
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
  v_synced_at timestamptz := now();
  v_match_id uuid := (p_match->>'id')::uuid;
  v_event_id uuid := (p_match->>'eventId')::uuid;
  v_participant_name text := COALESCE(p_match->>'participantName', '');
  v_participant_phone text := COALESCE(p_match->>'participantPhone', '');
  v_score integer := (p_match->>'score')::integer;
  v_total_questions integer := (p_match->>'totalQuestions')::integer;
  v_time_seconds integer := (p_match->>'timeSeconds')::integer;
  v_answers jsonb := COALESCE(p_match->'answers', '[]'::jsonb);
  v_played_at timestamptz := (p_match->>'playedAt')::timestamptz;
  v_stock_remaining integer := NULL;
  v_claim_id uuid;
  v_claim_phone text;
  v_claim_name text;
  v_claim_requested_status text;
  v_claim_awarded_at timestamptz;
  v_claim_delivered_at timestamptz;
  v_existing_claim record;
  v_resolved_claim jsonb := NULL;
BEGIN
  IF p_totem_id IS NULL OR NULLIF(trim(COALESCE(p_device_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Credenciais do Totem são obrigatórias.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.quiz_totems
     WHERE id = p_totem_id
       AND device_token = p_device_token
       AND is_paired = true
  ) THEN
    RAISE EXCEPTION 'Totem não autorizado ou device_token inválido.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.quiz_matches (
    id,
    event_id,
    totem_id,
    participant_name,
    participant_phone,
    score,
    total_questions,
    time_seconds,
    answers,
    played_at,
    synced_at
  )
  VALUES (
    v_match_id,
    v_event_id,
    p_totem_id,
    v_participant_name,
    v_participant_phone,
    v_score,
    v_total_questions,
    v_time_seconds,
    v_answers,
    v_played_at,
    v_synced_at
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT prize_stock_remaining
    INTO v_stock_remaining
    FROM public.quiz_events
   WHERE id = v_event_id;

  IF p_prize_claim IS NOT NULL THEN
    v_claim_id := (p_prize_claim->>'id')::uuid;
    v_claim_name := COALESCE(p_prize_claim->>'participantName', v_participant_name);
    v_claim_phone := COALESCE(p_prize_claim->>'participantPhone', v_participant_phone);
    v_claim_requested_status := CASE
      WHEN p_prize_claim->>'status' = 'delivered' THEN 'delivered'
      ELSE 'awaiting_pickup'
    END;
    v_claim_awarded_at := COALESCE((p_prize_claim->>'awardedAt')::timestamptz, v_played_at);
    v_claim_delivered_at := CASE
      WHEN v_claim_requested_status = 'delivered'
      THEN COALESCE((p_prize_claim->>'deliveredAt')::timestamptz, v_claim_awarded_at)
      ELSE NULL
    END;

    SELECT id, event_id, match_id, totem_id, participant_name, participant_phone, status, created_at, delivered_at
      INTO v_existing_claim
      FROM public.quiz_prize_claims
     WHERE id = v_claim_id;

    IF FOUND THEN
      v_resolved_claim := jsonb_build_object(
        'id', v_existing_claim.id,
        'event_id', v_existing_claim.event_id,
        'match_id', v_existing_claim.match_id,
        'totem_id', v_existing_claim.totem_id,
        'phone_hash', public.quiz_hash_event_phone(v_existing_claim.event_id, v_existing_claim.participant_phone),
        'status', v_existing_claim.status,
        'awarded_at', v_existing_claim.created_at,
        'delivered_at', v_existing_claim.delivered_at
      );
    ELSE
      BEGIN
        INSERT INTO public.quiz_prize_claims (
          id,
          event_id,
          match_id,
          totem_id,
          participant_name,
          participant_phone,
          status,
          delivered_at,
          created_at
        )
        VALUES (
          v_claim_id,
          v_event_id,
          v_match_id,
          p_totem_id,
          v_claim_name,
          v_claim_phone,
          v_claim_requested_status,
          v_claim_delivered_at,
          v_claim_awarded_at
        );

        v_stock_remaining := public.quiz_consume_event_prize_stock(v_event_id);
        IF v_stock_remaining IS NOT NULL AND v_stock_remaining < 0 THEN
          PERFORM public.quiz_revoke_exhausted_prize_claim(v_claim_id);
          v_claim_requested_status := 'revoked';
          v_claim_delivered_at := NULL;
          v_stock_remaining := 0;
        END IF;

        v_resolved_claim := jsonb_build_object(
          'id', v_claim_id,
          'event_id', v_event_id,
          'match_id', v_match_id,
          'totem_id', p_totem_id,
          'phone_hash', public.quiz_hash_event_phone(v_event_id, v_claim_phone),
          'status', v_claim_requested_status,
          'awarded_at', v_claim_awarded_at,
          'delivered_at', v_claim_delivered_at
        );
      EXCEPTION
        WHEN unique_violation THEN
          INSERT INTO public.quiz_prize_claims (
            id,
            event_id,
            match_id,
            totem_id,
            participant_name,
            participant_phone,
            status,
            delivered_at,
            created_at
          )
          VALUES (
            v_claim_id,
            v_event_id,
            v_match_id,
            p_totem_id,
            v_claim_name,
            v_claim_phone,
            'offline_duplicate_conflict',
            NULL,
            v_claim_awarded_at
          )
          ON CONFLICT (id) DO NOTHING;

          v_resolved_claim := jsonb_build_object(
            'id', v_claim_id,
            'event_id', v_event_id,
            'match_id', v_match_id,
            'totem_id', p_totem_id,
            'phone_hash', public.quiz_hash_event_phone(v_event_id, v_claim_phone),
            'status', 'offline_duplicate_conflict',
            'awarded_at', v_claim_awarded_at,
            'delivered_at', NULL
          );
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'syncedAt', v_synced_at,
    'resolvedPrizeClaim', v_resolved_claim,
    'prizeStockRemaining', v_stock_remaining
  );
END;
$$;

-- Registra Bloqueio por Desistência autenticado por device_token do Totem.
CREATE OR REPLACE FUNCTION public.quiz_totem_push_give_up_lockout(
  p_totem_id uuid,
  p_device_token text,
  p_lockout jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_synced_at timestamptz := now();
BEGIN
  IF p_totem_id IS NULL OR NULLIF(trim(COALESCE(p_device_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Credenciais do Totem são obrigatórias.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.quiz_totems
     WHERE id = p_totem_id
       AND device_token = p_device_token
       AND is_paired = true
  ) THEN
    RAISE EXCEPTION 'Totem não autorizado ou device_token inválido.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.quiz_give_up_lockouts (
    id,
    event_id,
    totem_id,
    participant_phone,
    locked_at,
    expires_at
  )
  VALUES (
    (p_lockout->>'id')::uuid,
    (p_lockout->>'eventId')::uuid,
    p_totem_id,
    COALESCE(p_lockout->>'participantPhone', ''),
    (p_lockout->>'lockedAt')::timestamptz,
    (p_lockout->>'expiresAt')::timestamptz
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN jsonb_build_object('syncedAt', v_synced_at);
END;
$$;

REVOKE ALL ON FUNCTION public.quiz_totem_pull_event_snapshot(uuid, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_totem_pull_event_snapshot(uuid, text, uuid, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.quiz_totem_push_match(uuid, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_totem_push_match(uuid, text, jsonb, jsonb) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.quiz_totem_push_give_up_lockout(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_totem_push_give_up_lockout(uuid, text, jsonb) TO anon, authenticated;
