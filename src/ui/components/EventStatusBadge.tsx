import { cn } from '../lib/utils';

export interface EventStatusBadgeProps {
  isActive: boolean;
  className?: string;
}

export function EventStatusBadge({ isActive, className }: EventStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        isActive
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {isActive ? 'Ativo' : 'Encerrado'}
    </span>
  );
}
