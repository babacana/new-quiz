import { LANGUAGES, useLanguage, type Language } from '../../i18n';

const FLAGS: Record<Language, { flag: string; name: string }> = {
  pt: { flag: '🇧🇷', name: 'Português' },
  en: { flag: '🇺🇸', name: 'English' },
  es: { flag: '🇪🇸', name: 'Español' },
};

export interface LanguageSelectorProps {
  /** Idiomas oferecidos; por padrão todos. */
  languages?: readonly Language[];
  onSelect?: () => void;
}

// Bandeiras para o Participante escolher o idioma do Totem; volta ao português na Tela de Descanso.
export function LanguageSelector({ languages = LANGUAGES, onSelect }: LanguageSelectorProps) {
  const { language, setLanguage, t } = useLanguage();

  if (languages.length < 2) {
    return null;
  }

  return (
    <div className="language-selector" role="group" aria-label={t('language.label')}>
      {languages.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          className={code === language ? 'language-option active' : 'language-option'}
          aria-pressed={code === language}
          aria-label={FLAGS[code].name}
          title={FLAGS[code].name}
          onClick={() => {
            setLanguage(code);
            onSelect?.();
          }}
        >
          <span aria-hidden="true">{FLAGS[code].flag}</span>
        </button>
      ))}
    </div>
  );
}
