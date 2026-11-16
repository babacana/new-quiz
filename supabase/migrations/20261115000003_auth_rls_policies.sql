-- Migração de autenticação, perfis RBAC e políticas RLS (Administrador vs Operador vs Totem)
-- Issue #5 (T4): diferencia controle administrativo total (admin) da visão restrita (operator).

-- Função auxiliar segura para obter o papel do usuário autenticado sem recursão infinita em RLS.
CREATE OR REPLACE FUNCTION public.quiz_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.quiz_profiles WHERE id = auth.uid();
$$;

-- Garante que o consumo atômico de estoque de Brindes e revogação por estoque esgotado funcionem com RLS restritivo.
ALTER FUNCTION public.quiz_consume_event_prize_stock(uuid)
  SECURITY DEFINER
  SET search_path = public;

CREATE OR REPLACE FUNCTION public.quiz_revoke_exhausted_prize_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.quiz_prize_claims
     SET status = 'revoked',
         delivered_at = NULL
   WHERE id = p_claim_id
     AND status IN ('awaiting_pickup', 'delivered');
END;
$$;

-- Habilita Row Level Security em todas as tabelas de domínio.
ALTER TABLE public.quiz_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_event_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_totems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_prize_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_give_up_lockouts ENABLE ROW LEVEL SECURITY;

-- ========================
-- Políticas para QUIZ_PROFILES
-- ========================
CREATE POLICY quiz_profiles_select_self_or_admin
  ON public.quiz_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR (SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_profiles_insert_admin_only
  ON public.quiz_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_profiles_update_admin_only
  ON public.quiz_profiles
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin')
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_profiles_delete_admin_only
  ON public.quiz_profiles
  FOR DELETE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin');

-- ========================
-- Políticas para QUIZ_EVENTS
-- ========================
CREATE POLICY quiz_events_select_public_and_staff
  ON public.quiz_events
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY quiz_events_insert_admin_only
  ON public.quiz_events
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_events_update_admin_only
  ON public.quiz_events
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin')
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_events_delete_admin_only
  ON public.quiz_events
  FOR DELETE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin');

-- ========================
-- Políticas para QUIZ_QUESTIONS
-- ========================
CREATE POLICY quiz_questions_select_public_and_staff
  ON public.quiz_questions
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY quiz_questions_insert_admin_only
  ON public.quiz_questions
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_questions_update_admin_only
  ON public.quiz_questions
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin')
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_questions_delete_admin_only
  ON public.quiz_questions
  FOR DELETE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin');

-- =============================
-- Políticas para QUIZ_EVENT_QUESTIONS
-- =============================
CREATE POLICY quiz_event_questions_select_public_and_staff
  ON public.quiz_event_questions
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY quiz_event_questions_insert_admin_only
  ON public.quiz_event_questions
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_event_questions_update_admin_only
  ON public.quiz_event_questions
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin')
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_event_questions_delete_admin_only
  ON public.quiz_event_questions
  FOR DELETE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin');

-- ========================
-- Políticas para QUIZ_TOTEMS
-- ========================
CREATE POLICY quiz_totems_select_staff_only
  ON public.quiz_totems
  FOR SELECT
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

CREATE POLICY quiz_totems_insert_admin_only
  ON public.quiz_totems
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_totems_update_admin_only
  ON public.quiz_totems
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin')
  WITH CHECK ((SELECT public.quiz_current_user_role()) = 'admin');

CREATE POLICY quiz_totems_delete_admin_only
  ON public.quiz_totems
  FOR DELETE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin');

-- ========================
-- Políticas para QUIZ_MATCHES
-- ========================
CREATE POLICY quiz_matches_select_public_and_staff
  ON public.quiz_matches
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY quiz_matches_insert_totem_and_admin
  ON public.quiz_matches
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY quiz_matches_delete_admin_only
  ON public.quiz_matches
  FOR DELETE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin');

-- ===========================
-- Políticas para QUIZ_PRIZE_CLAIMS
-- ===========================
CREATE POLICY quiz_prize_claims_select_public_and_staff
  ON public.quiz_prize_claims
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY quiz_prize_claims_insert_totem_and_staff
  ON public.quiz_prize_claims
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY quiz_prize_claims_update_staff_only
  ON public.quiz_prize_claims
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'))
  WITH CHECK ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

CREATE POLICY quiz_prize_claims_delete_admin_only
  ON public.quiz_prize_claims
  FOR DELETE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin');

-- ================================
-- Políticas para QUIZ_GIVE_UP_LOCKOUTS
-- ================================
CREATE POLICY quiz_give_up_lockouts_select_public_and_staff
  ON public.quiz_give_up_lockouts
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY quiz_give_up_lockouts_insert_totem_and_staff
  ON public.quiz_give_up_lockouts
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY quiz_give_up_lockouts_update_staff
  ON public.quiz_give_up_lockouts
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'))
  WITH CHECK ((SELECT public.quiz_current_user_role()) IN ('admin', 'operator'));

CREATE POLICY quiz_give_up_lockouts_delete_admin_only
  ON public.quiz_give_up_lockouts
  FOR DELETE
  TO authenticated
  USING ((SELECT public.quiz_current_user_role()) = 'admin');
