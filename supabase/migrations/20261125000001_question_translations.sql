-- ============================================================
-- Traduções EN/ES das perguntas (Banco de Questões).
-- Aditiva e retrocompatível: a coluna tem padrão '{}' e o app antigo continua funcionando.
-- Só a coluna; as funções que levam o campo ao Totem estão em 20261125000002.
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
