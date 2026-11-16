import { Moon, Sun } from 'lucide-react';
import type { SaasTheme } from '../hooks/useSaasTheme';
import { Button } from './ui/button';

export interface ThemeToggleButtonProps {
  theme: SaasTheme;
  onToggleTheme: () => void;
}

export function ThemeToggleButton({ theme, onToggleTheme }: ThemeToggleButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Alternar tema"
      onClick={onToggleTheme}
      title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
