import type { RefObject } from 'react';
import type { Language } from '../../i18n';
import { formatPhoneMask, normalizeParticipantName } from '../../domain/totemSessionEngine';
import type { EventCustomizationTexts, EventWindowState } from '../../domain/types';
import type { ResolvedScreenLayout } from '../../domain/screenLayout';
import { useLanguage } from '../../i18n';
import { EventLogoImage } from '../EventLogoImage';
import { LayoutScreenContent } from './LayoutScreenContent';
import { LanguageSelector } from './LanguageSelector';
import {
  VirtualKeyboard,
  type VirtualKeyboardField,
} from '../VirtualKeyboard';

export interface TotemInitialScreenProps {
  active: boolean;
  logoSrc: string;
  texts: EventCustomizationTexts;
  eventWindow: EventWindowState;
  lgpdNoticeText?: string;
  nameInput: string;
  phoneInput: string;
  nameInputRef: RefObject<HTMLInputElement | null>;
  phoneInputRef: RefObject<HTMLInputElement | null>;
  shouldHideStartButton: boolean;
  activeVirtualField: VirtualKeyboardField | null;
  enableVirtualKeyboard: boolean;
  virtualKeyboardHeightVh: number;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onFieldFocus: (field: VirtualKeyboardField) => void;
  onStartQuiz: () => void;
  onOpenRanking: () => void;
  onVirtualKeyboardHeightChange: (heightVh: number) => void;
  onVirtualKeyPress: (key: string) => void;
  onVirtualKeyboardResizingChange: (isResizing: boolean) => void;
  onVirtualKeyboardClose?: () => void;
  /** Idiomas oferecidos na tela; sem a prop, todos. */
  availableLanguages?: readonly Language[];
  /** Layout resolvido do Evento; sem ele usa a distribuição padrão. */
  layout?: ResolvedScreenLayout;
  /** Elemento destacado no editor de layout do ADM. */
  highlightedElementId?: string | null;
}

// Tela inicial do Totem com cadastro do Participante, aviso LGPD, teclado virtual e acesso ao Ranking.
export function TotemInitialScreen({
  active,
  logoSrc,
  texts,
  eventWindow,
  lgpdNoticeText,
  nameInput,
  phoneInput,
  nameInputRef,
  phoneInputRef,
  shouldHideStartButton,
  activeVirtualField,
  enableVirtualKeyboard,
  virtualKeyboardHeightVh,
  onNameChange,
  onPhoneChange,
  onFieldFocus,
  onStartQuiz,
  onOpenRanking,
  onVirtualKeyboardHeightChange,
  onVirtualKeyPress,
  onVirtualKeyboardResizingChange,
  onVirtualKeyboardClose,
  layout,
  highlightedElementId,
  availableLanguages,
}: TotemInitialScreenProps) {
  const { t, td, language } = useLanguage();
  return (
    <section
      id="initial-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      {active && <LanguageSelector languages={availableLanguages} />}
      <LayoutScreenContent
        screenId="initial"
        layout={layout}
        highlightedElementId={highlightedElementId}
        elements={{
          logo: <EventLogoImage src={logoSrc} />,
          title: <h2>{td(texts.initialScreenTitle)}</h2>,
          slogan: <p className="slogan">{td(texts.initialScreenSlogan)}</p>,
          statusMessage:
            eventWindow.initialScreenMessage !== null ? (
              <p id="event-status-message">{td(eventWindow.initialScreenMessage)}</p>
            ) : null,
          intro: <p>{t('initial.intro')}</p>,
          nameField: (
            <div className="form-group">
              <label htmlFor="nome">{t('initial.nameLabel')}</label>
              <input
                ref={nameInputRef}
                id="nome"
                name="nome"
                type="text"
                autoComplete="off"
                placeholder={td(texts.inputNamePlaceholder)}
                value={nameInput}
                onFocus={() => onFieldFocus('nome')}
                onChange={(event) => onNameChange(normalizeParticipantName(event.target.value))}
              />
            </div>
          ),
          phoneField: (
            <div className="form-group">
              <label htmlFor="telefone">{t('initial.phoneLabel')}</label>
              <input
                ref={phoneInputRef}
                id="telefone"
                name="telefone"
                type="tel"
                autoComplete="off"
                placeholder={td(texts.inputPhonePlaceholder)}
                value={phoneInput}
                onFocus={() => onFieldFocus('telefone')}
                onChange={(event) => onPhoneChange(formatPhoneMask(event.target.value))}
              />
            </div>
          ),
          lgpd: lgpdNoticeText?.trim() ? (
            <p id="lgpd-notice-text" className="lgpd-notice-text">
              {td(lgpdNoticeText.trim())}
            </p>
          ) : null,
          startButton: (
            <button
              id="start-quiz-btn"
              type="button"
              className={shouldHideStartButton ? 'btn hidden' : 'btn'}
              disabled={eventWindow.isBlocked}
              hidden={shouldHideStartButton}
              onClick={onStartQuiz}
            >
              {td(texts.initialScreenStartButton)}
            </button>
          ),
          rankingButton: (
            <button
              id="view-ranking-initial-btn"
              type="button"
              className="btn-secondary"
              onClick={onOpenRanking}
            >
              {td(texts.initialScreenRankingButton)}
            </button>
          ),
        }}
      />

      <VirtualKeyboard
        activeField={active ? activeVirtualField : null}
        enabled={enableVirtualKeyboard}
        heightVh={virtualKeyboardHeightVh}
        onHeightVhChange={onVirtualKeyboardHeightChange}
        onKeyPress={onVirtualKeyPress}
        onResizingChange={onVirtualKeyboardResizingChange}
        onClose={onVirtualKeyboardClose}
        language={language}
      />
    </section>
  );
}
