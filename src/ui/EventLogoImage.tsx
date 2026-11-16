export interface EventLogoImageProps {
  src: string;
  alt?: string;
  className?: string;
}

// Exibe o logotipo do Evento com fallback automático para o logotipo padrão em caso de erro de carregamento.
export function EventLogoImage({
  src,
  alt = 'Logo do Evento',
  className = 'event-logo',
}: EventLogoImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={(event) => {
        if (!event.currentTarget.src.endsWith('/assets/logo.png')) {
          event.currentTarget.src = '/assets/logo.png';
        }
      }}
    />
  );
}
