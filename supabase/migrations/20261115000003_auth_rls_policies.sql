-- Migração de autenticação, perfis RBAC e políticas RLS (Administrador vs Operador vs Totem)
-- Issue #5 (T4): diferencia controle administrativo total (admin) da visão restrita (operator).

-- Função auxiliar segura para obter o papel do usuário autenticado sem recursão infinita em RLS.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Garante que o consumo atômico de estoque de Brindes e revogação por estoque esgotado funcionem com RLS restritivo.
ALTER FUNCTION public.consume_event_prize_stock(uuid)
  SECURITY DEFINER
  SET search_path = public;

CREATE OR REPLACE FUNCTION public.revoke_exhausted_prize_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.prize_claims
     SET status = 'revoked',
         delivered_at = NULL
   WHERE id = p_claim_id
     AND status IN ('awaiting_pickup', 'delivered');
END;
$$;

-- Habilita Row Level Security em todas as tabelas de domínio.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.totems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prize_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.give_up_lockouts ENABLE ROW LEVEL SECURITY;

-- ========================
-- Políticas para PROFILES
-- ========================
CREATE POLICY profiles_select_self_or_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.current_user_role() = 'admin');

CREATE POLICY profiles_insert_admin_only
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY profiles_update_admin_only
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY profiles_delete_admin_only
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- ========================
-- Políticas para EVENTS
-- ========================
CREATE POLICY events_select_public_and_staff
  ON public.events
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY events_insert_admin_only
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY events_update_admin_only
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY events_delete_admin_only
  ON public.events
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- ========================
-- Políticas para QUESTIONS
-- ========================
CREATE POLICY questions_select_public_and_staff
  ON public.questions
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY questions_insert_admin_only
  ON public.questions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY questions_update_admin_only
  ON public.questions
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY questions_delete_admin_only
  ON public.questions
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- =============================
-- Políticas para EVENT_QUESTIONS
-- =============================
CREATE POLICY event_questions_select_public_and_staff
  ON public.event_questions
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY event_questions_insert_admin_only
  ON public.event_questions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY event_questions_update_admin_only
  ON public.event_questions
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY event_questions_delete_admin_only
  ON public.event_questions
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- ========================
-- Políticas para TOTEMS
-- ========================
CREATE POLICY totems_select_staff_only
  ON public.totems
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() IN ('admin', 'operator'));

CREATE POLICY totems_insert_admin_only
  ON public.totems
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY totems_update_admin_only
  ON public.totems
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY totems_delete_admin_only
  ON public.totems
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- ========================
-- Políticas para MATCHES
-- ========================
CREATE POLICY matches_select_public_and_staff
  ON public.matches
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY matches_insert_totem_and_admin
  ON public.matches
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY matches_delete_admin_only
  ON public.matches
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- ===========================
-- Políticas para PRIZE_CLAIMS
-- ===========================
CREATE POLICY prize_claims_select_public_and_staff
  ON public.prize_claims
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY prize_claims_insert_totem_and_staff
  ON public.prize_claims
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY prize_claims_update_staff_only
  ON public.prize_claims
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() IN ('admin', 'operator'))
  WITH CHECK (public.current_user_role() IN ('admin', 'operator'));

CREATE POLICY prize_claims_delete_admin_only
  ON public.prize_claims
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- ================================
-- Políticas para GIVE_UP_LOCKOUTS
-- ================================
CREATE POLICY give_up_lockouts_select_public_and_staff
  ON public.give_up_lockouts
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY give_up_lockouts_insert_totem_and_staff
  ON public.give_up_lockouts
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY give_up_lockouts_update_staff
  ON public.give_up_lockouts
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role() IN ('admin', 'operator'))
  WITH CHECK (public.current_user_role() IN ('admin', 'operator'));

CREATE POLICY give_up_lockouts_delete_admin_only
  ON public.give_up_lockouts
  FOR DELETE
  TO authenticated
  USING (public.current_user_role() = 'admin');
