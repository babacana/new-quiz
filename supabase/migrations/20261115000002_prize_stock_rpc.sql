-- Função atômica para validar e decrementar o estoque de Brindes de um Evento na nuvem.
-- Retorna:
--   NULL se o Evento não utiliza limite de estoque (`prize_stock_remaining IS NULL`),
--   >= 0 com o saldo restante após o decremento,
--   -1 se o estoque já estiver esgotado (`prize_stock_remaining <= 0`).
CREATE OR REPLACE FUNCTION public.quiz_consume_event_prize_stock(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_stock integer;
  v_updated_stock integer;
BEGIN
  SELECT prize_stock_remaining
    INTO v_current_stock
    FROM public.quiz_events
   WHERE id = p_event_id
   FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_current_stock <= 0 THEN
    RETURN -1;
  END IF;

  UPDATE public.quiz_events
     SET prize_stock_remaining = prize_stock_remaining - 1,
         updated_at = now()
   WHERE id = p_event_id
   RETURNING prize_stock_remaining INTO v_updated_stock;

  RETURN v_updated_stock;
END;
$$;
