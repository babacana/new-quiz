// Logo estilizada da CAESB (embutida no app e no cache offline), elemento opcional de algumas telas do Totem.
export const STYLIZED_LOGO_SRC = '/assets/logo-estilizada.png';

export function StylizedLogoImage() {
  return <img src={STYLIZED_LOGO_SRC} alt="CAESB" className="event-logo idle-stylized-logo" />;
}
