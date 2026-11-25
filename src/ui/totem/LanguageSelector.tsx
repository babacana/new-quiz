import { useEffect, useRef, useState } from 'react';
import { LANGUAGES, useLanguage, type Language } from '../../i18n';

const NAMES: Record<Language, string> = {
  pt: 'Português',
  en: 'English',
  es: 'Español',
};

// Bandeiras em SVG (emoji de bandeira não renderiza no Windows/Chrome); círculo de 64x64.
function Flag({ code }: { code: Language }) {
  const clipId = `flag-clip-${code}`;
  return (
    <svg className="language-flag" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="31" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {code === 'pt' && (
          <>
            <rect width="64" height="64" fill="#009b3a" />
            <polygon points="32,8 60,32 32,56 4,32" fill="#fedf00" />
            <circle cx="32" cy="32" r="12" fill="#002776" />
            <path d="M21 30 Q32 26 43 34" stroke="#fff" strokeWidth="2.2" fill="none" />
          </>
        )}
        {code === 'en' && (
          <>
            <rect width="64" height="64" fill="#fff" />
            {[0, 2, 4, 6, 8, 10, 12].map((i) => (
              <rect key={i} y={(i * 64) / 13} width="64" height={64 / 13} fill="#b22234" />
            ))}
            <rect width="30" height={(64 * 7) / 13} fill="#3c3b6e" />
            {[0, 1, 2].map((row) =>
              [0, 1, 2].map((col) => (
                <circle key={`${row}-${col}`} cx={6 + col * 9 + (row % 2) * 0} cy={7 + row * 10} r="1.8" fill="#fff" />
              )),
            )}
          </>
        )}
        {code === 'es' && (
          <>
            <rect width="64" height="64" fill="#aa151b" />
            <rect y="16" width="64" height="32" fill="#f1bf00" />
          </>
        )}
      </g>
    </svg>
  );
}

export interface LanguageSelectorProps {
  /** Idiomas oferecidos; por padrão todos. */
  languages?: readonly Language[];
  onSelect?: () => void;
}

// Mostra só a bandeira do idioma atual; ao tocar, as outras deslizam ao lado, e ao escolher recolhem.
// Volta ao português na Tela de Descanso.
export function LanguageSelector({ languages = LANGUAGES, onSelect }: LanguageSelectorProps) {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const close = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (languages.length < 2) {
    return null;
  }

  const others = languages.filter((code) => code !== language);

  return (
    <div
      ref={rootRef}
      className={open ? 'language-selector open' : 'language-selector'}
      role="group"
      aria-label={t('language.label')}
    >
      <button
        type="button"
        lang={language}
        className="language-option active"
        aria-expanded={open}
        aria-label={NAMES[language]}
        title={NAMES[language]}
        onClick={() => setOpen((value) => !value)}
      >
        <Flag code={language} />
      </button>
      <div className="language-options" aria-hidden={!open}>
        {others.map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            className="language-option"
            tabIndex={open ? 0 : -1}
            aria-label={NAMES[code]}
            title={NAMES[code]}
            onClick={() => {
              setLanguage(code);
              setOpen(false);
              onSelect?.();
            }}
          >
            <Flag code={code} />
          </button>
        ))}
      </div>
    </div>
  );
}
