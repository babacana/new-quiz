import type { RefObject } from 'react';
import { formatPhoneMask, normalizeParticipantName } from '../../domain/totemSessionEngine';
import type { EventCustomizationTexts, EventWindowState } from '../../domain/types';
import type { ResolvedScreenLayout } from '../../domain/screenLayout';
import { EventLogoImage } from '../EventLogoImage';
import { LayoutScreenContent } from './LayoutScreenContent';
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
  layout,
  highlightedElementId,
}: TotemInitialScreenProps) {
  return (
    <section
      id="initial-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      <LayoutScreenContent
        screenId="initial"
        layout={layout}
        highlightedElementId={highlightedElementId}
        elements={{
          logo: <EventLogoImage src={logoSrc} />,
          title: <h2>{texts.initialScreenTitle}</h2>,
          slogan: <p className="slogan">{texts.initialScreenSlogan}</p>,
          statusMessage:
            eventWindow.initialScreenMessage !== null ? (
              <p id="event-status-message">{eventWindow.initialScreenMessage}</p>
            ) : null,
          intro: <p>Preencha seus dados para começar:</p>,
          nameField: (
            <div className="form-group">
              <label htmlFor="nome">Nome</label>
              <input
                ref={nameInputRef}
                id="nome"
                name="nome"
                type="text"
                autoComplete="off"
                placeholder={texts.inputNamePlaceholder}
                value={nameInput}
                onFocus={() => onFieldFocus('nome')}
                onChange={(event) => onNameChange(normalizeParticipantName(event.target.value))}
              />
            </div>
          ),
          phoneField: (
            <div className="form-group">
              <label htmlFor="telefone">Telefone</label>
              <input
                ref={phoneInputRef}
                id="telefone"
                name="telefone"
                type="tel"
                autoComplete="off"
                placeholder={texts.inputPhonePlaceholder}
                value={phoneInput}
                onFocus={() => onFieldFocus('telefone')}
                onChange={(event) => onPhoneChange(formatPhoneMask(event.target.value))}
              />
            </div>
          ),
          lgpd: lgpdNoticeText?.trim() ? (
            <p id="lgpd-notice-text" className="lgpd-notice-text">
              {lgpdNoticeText.trim()}
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
              {texts.initialScreenStartButton}
            </button>
          ),
          rankingButton: (
            <button
              id="view-ranking-initial-btn"
              type="button"
              className="btn-secondary"
              onClick={onOpenRanking}
            >
              {texts.initialScreenRankingButton}
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
      />
    </section>
  );
}
