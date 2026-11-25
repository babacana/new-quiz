-- ============================================================
-- Traduções EN/ES das perguntas (Banco de Questões).
-- Aditiva e retrocompatível: a coluna tem padrão '{}' e o app antigo continua funcionando.
-- Formato: {"en": {"text": "...", "options": ["a","b","c","d"]}, "es": {...}}
-- Os textos do Evento traduzidos ficam em quiz_events.customizations.translations (jsonb existente),
-- sem mudança de schema.
-- ============================================================

ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'quiz_questions_translations_is_object'
       AND conrelid = 'public.quiz_questions'::regclass
  ) THEN
    ALTER TABLE public.quiz_questions
      ADD CONSTRAINT quiz_questions_translations_is_object
      CHECK (jsonb_typeof(translations) = 'object');
  END IF;
END
$$;

-- Snapshot do Totem passa a incluir as traduções das questões (mesma função da migração 20261118000001).
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
          'is_disabled', q.is_disabled,
          'translations', q.translations
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
          'is_disabled', q.is_disabled,
          'translations', q.translations
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

REVOKE ALL ON FUNCTION public.quiz_totem_pull_event_snapshot(uuid, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_totem_pull_event_snapshot(uuid, text, uuid, timestamptz) TO anon, authenticated;

-- Substituição atômica do Banco de Questões passa a gravar as traduções (função da migração 20261123000001).
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

  INSERT INTO public.quiz_questions (id, text, options, correct_index, difficulty, tags, is_disabled, translations)
  SELECT (e->>'id')::bigint,
         e->>'text',
         e->'options',
         (e->>'correct_index')::smallint,
         e->>'difficulty',
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(e->'tags', '[]'::jsonb))), '{}'),
         COALESCE((e->>'is_disabled')::boolean, false),
         COALESCE(e->'translations', '{}'::jsonb)
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
