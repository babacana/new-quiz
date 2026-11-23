-- Testes das regras de Brinde no SQL: estoque, Trava (um Brinde ativo por telefone), conflito offline,
-- idempotência e permissões. Cada bloco falha com RAISE EXCEPTION; tudo roda numa transação revertida.
BEGIN;

CREATE FUNCTION pg_temp.expect(p_cond boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', p_msg; END IF; END $$;

-- Fixture: Evento com estoque 2, Totem pareado, Evento sem limite de estoque.
INSERT INTO quiz_events (id, name, slug, prize_stock_remaining) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Evento com estoque', 'ev-estoque', 2),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Evento sem limite', 'ev-ilimitado', NULL);
INSERT INTO quiz_totems (id, name, pairing_code, device_token, event_id, is_paired) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Totem 1', 'AAA111', 'tok-1', 'aaaaaaaa-0000-4000-8000-000000000001', true),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Totem 2', 'BBB222', 'tok-2', 'aaaaaaaa-0000-4000-8000-000000000001', true);

CREATE FUNCTION pg_temp.push(p_event uuid, p_totem uuid, p_token text, p_match uuid, p_claim uuid, p_phone text, p_status text DEFAULT 'delivered')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.quiz_totem_push_match(
    p_totem, p_token,
    jsonb_build_object('id', p_match, 'eventId', p_event, 'participantName', 'Fulano', 'participantPhone', p_phone,
                       'score', 8, 'totalQuestions', 10, 'timeSeconds', 60, 'playedAt', now()),
    jsonb_build_object('id', p_claim, 'status', p_status, 'participantPhone', p_phone));
$$;

-- 1) quiz_consume_event_prize_stock: decrementa, esgota em -1 e ignora Evento sem limite.
DO $$
DECLARE e1 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; e2 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
BEGIN
  PERFORM pg_temp.expect(public.quiz_consume_event_prize_stock(e1) = 1, 'primeiro consumo deixa saldo 1');
  PERFORM pg_temp.expect(public.quiz_consume_event_prize_stock(e1) = 0, 'segundo consumo deixa saldo 0');
  PERFORM pg_temp.expect(public.quiz_consume_event_prize_stock(e1) = -1, 'estoque zerado devolve -1');
  PERFORM pg_temp.expect((SELECT prize_stock_remaining FROM quiz_events WHERE id = e1) = 0, 'saldo nunca fica negativo');
  PERFORM pg_temp.expect(public.quiz_consume_event_prize_stock(e2) IS NULL, 'Evento sem limite devolve NULL');
  PERFORM pg_temp.expect((SELECT prize_stock_remaining FROM quiz_events WHERE id = e2) IS NULL, 'Evento sem limite continua NULL');
  UPDATE quiz_events SET prize_stock_remaining = 2 WHERE id = e1; -- restaura para os próximos cenários
END $$;

-- 2) Permissões: só as RPCs do Totem (SECURITY DEFINER) podem consumir estoque ou revogar Brindes.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.expect(NOT has_function_privilege(r, 'public.quiz_consume_event_prize_stock(uuid)', 'EXECUTE'), r || ' não pode consumir estoque');
    PERFORM pg_temp.expect(NOT has_function_privilege(r, 'public.quiz_revoke_exhausted_prize_claim(uuid)', 'EXECUTE'), r || ' não pode revogar Brinde');
    PERFORM pg_temp.expect(NOT has_function_privilege(r, 'public.quiz_totem_push_match_unchecked(uuid, text, jsonb, jsonb)', 'EXECUTE'), r || ' não chama a implementação interna');
    PERFORM pg_temp.expect(has_function_privilege(r, 'public.quiz_totem_push_match(uuid, text, jsonb, jsonb)', 'EXECUTE'), r || ' chama a RPC pública do Totem');
  END LOOP;
END $$;

-- 3) Brinde concedido consome estoque; modo dinâmico entrega na hora, confirmação manual aguarda retirada.
DO $$
DECLARE e1 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; t1 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
        res jsonb;
BEGIN
  res := pg_temp.push(e1, t1, 'tok-1', gen_random_uuid(), 'cccccccc-0000-4000-8000-000000000001', '(61) 99999-0001', 'delivered');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim'->>'status' = 'delivered', 'modo dinâmico entrega na hora');
  PERFORM pg_temp.expect((res->>'prizeStockRemaining')::int = 1, 'estoque cai de 2 para 1');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim' ? 'phone_hash' AND NOT res->'resolvedPrizeClaim' ? 'participant_phone', 'resposta só leva hash do telefone (LGPD)');

  res := pg_temp.push(e1, t1, 'tok-1', gen_random_uuid(), 'cccccccc-0000-4000-8000-000000000002', '(61) 99999-0002', 'awaiting_pickup');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim'->>'status' = 'awaiting_pickup', 'confirmação manual aguarda retirada');
  PERFORM pg_temp.expect((res->>'prizeStockRemaining')::int = 0, 'estoque cai para 0');
END $$;

-- 4) Estoque esgotado: o Brinde sai como revogado e o saldo não fica negativo.
DO $$
DECLARE e1 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; t1 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
        res jsonb;
BEGIN
  res := pg_temp.push(e1, t1, 'tok-1', gen_random_uuid(), 'cccccccc-0000-4000-8000-000000000003', '(61) 99999-0003');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim'->>'status' = 'revoked', 'sem estoque o Brinde é revogado');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim'->>'delivered_at' IS NULL, 'Brinde revogado não tem data de entrega');
  PERFORM pg_temp.expect((res->>'prizeStockRemaining')::int = 0, 'saldo continua 0');
  PERFORM pg_temp.expect((SELECT status FROM quiz_prize_claims WHERE id = 'cccccccc-0000-4000-8000-000000000003') = 'revoked', 'linha gravada como revoked');
  PERFORM pg_temp.expect((SELECT prize_stock_remaining FROM quiz_events WHERE id = e1) = 0, 'saldo no banco não fica negativo');
END $$;

-- 5) Idempotência: reenviar o mesmo Brinde não consome estoque de novo nem muda o status.
DO $$
DECLARE e2 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000002'; t1 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
        m uuid := gen_random_uuid(); res jsonb;
BEGIN
  UPDATE quiz_events SET prize_stock_remaining = 5 WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
  UPDATE quiz_totems SET event_id = 'aaaaaaaa-0000-4000-8000-000000000001' WHERE id = t1;
  PERFORM pg_temp.push('aaaaaaaa-0000-4000-8000-000000000001', t1, 'tok-1', m, 'cccccccc-0000-4000-8000-000000000010', '(61) 98888-0001');
  res := pg_temp.push('aaaaaaaa-0000-4000-8000-000000000001', t1, 'tok-1', m, 'cccccccc-0000-4000-8000-000000000010', '(61) 98888-0001');
  PERFORM pg_temp.expect((SELECT prize_stock_remaining FROM quiz_events WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001') = 4, 'reenvio não consome estoque de novo');
  PERFORM pg_temp.expect((SELECT count(*) FROM quiz_matches WHERE id = m) = 1, 'Partida não duplica');
  PERFORM pg_temp.expect((SELECT count(*) FROM quiz_prize_claims WHERE id = 'cccccccc-0000-4000-8000-000000000010') = 1, 'Brinde não duplica');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim'->>'status' = 'delivered', 'reenvio devolve o status já gravado');
END $$;

-- 6) Trava de Brinde / Conflito de Premiação Offline: o mesmo telefone em outro Totem vira conflito,
--    preserva a Partida e não consome estoque. (Hoje a trava vale sempre na nuvem, ignorando enablePrizeLock.)
DO $$
DECLARE e1 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; t2 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
        m uuid := gen_random_uuid(); res jsonb; before_stock int;
BEGIN
  SELECT prize_stock_remaining INTO before_stock FROM quiz_events WHERE id = e1;
  res := pg_temp.push(e1, t2, 'tok-2', m, 'cccccccc-0000-4000-8000-000000000011', '(61) 98888-0001');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim'->>'status' = 'offline_duplicate_conflict', 'segundo Brinde do mesmo telefone vira conflito');
  PERFORM pg_temp.expect((SELECT count(*) FROM quiz_matches WHERE id = m) = 1, 'Partida do conflito é preservada');
  PERFORM pg_temp.expect((SELECT prize_stock_remaining FROM quiz_events WHERE id = e1) = before_stock, 'conflito não consome estoque');
  PERFORM pg_temp.expect((SELECT count(*) FROM quiz_prize_claims WHERE event_id = e1 AND participant_phone = '(61) 98888-0001' AND status IN ('awaiting_pickup','delivered')) = 1, 'só um Brinde ativo por telefone');
END $$;

-- 7) A Trava é por Evento: o mesmo telefone pode ganhar em outro Evento.
DO $$
DECLARE e2 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000002'; t1 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001'; res jsonb;
BEGIN
  UPDATE quiz_totems SET event_id = e2 WHERE id = t1;
  res := pg_temp.push(e2, t1, 'tok-1', gen_random_uuid(), 'cccccccc-0000-4000-8000-000000000012', '(61) 98888-0001');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim'->>'status' = 'delivered', 'mesmo telefone ganha em outro Evento');
  PERFORM pg_temp.expect(res->>'prizeStockRemaining' IS NULL, 'Evento sem limite devolve saldo NULL');
END $$;

-- 8) Brinde revogado ou em conflito não ocupa a Trava: após despremiar (revoked), o telefone pode ganhar de novo.
DO $$
DECLARE e2 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000002'; t1 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001'; res jsonb;
BEGIN
  UPDATE quiz_prize_claims SET status = 'revoked', delivered_at = NULL WHERE id = 'cccccccc-0000-4000-8000-000000000012';
  res := pg_temp.push(e2, t1, 'tok-1', gen_random_uuid(), 'cccccccc-0000-4000-8000-000000000013', '(61) 98888-0001');
  PERFORM pg_temp.expect(res->'resolvedPrizeClaim'->>'status' = 'delivered', 'telefone despremiado pode ganhar novamente');
END $$;

-- 9) Autenticação e validação do Totem.
DO $$
DECLARE e1 constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; t1 constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
        ok boolean;
BEGIN
  BEGIN
    PERFORM pg_temp.push(e1, t1, 'token-errado', gen_random_uuid(), gen_random_uuid(), '(61) 97777-0001');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  PERFORM pg_temp.expect(ok, 'device_token inválido é recusado');

  BEGIN
    PERFORM public.quiz_totem_push_match(t1, 'tok-1',
      jsonb_build_object('id', gen_random_uuid(), 'eventId', e1, 'participantName', 'X', 'participantPhone', '1',
                         'score', 11, 'totalQuestions', 10, 'timeSeconds', 5, 'playedAt', now()), NULL);
    ok := false;
  EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  PERFORM pg_temp.expect(ok, 'placar maior que o total de questões é recusado');
END $$;

ROLLBACK;
\echo 'prize_rules.test.sql: OK'
