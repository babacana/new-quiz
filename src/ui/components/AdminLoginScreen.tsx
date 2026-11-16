import type { FormEvent } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import type { SaasTheme } from '../hooks/useSaasTheme';
import { ThemeToggleButton } from './ThemeToggleButton';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

export interface AdminLoginScreenProps {
  routeMode: 'admin' | 'operator';
  theme: SaasTheme;
  onToggleTheme: () => void;
  email: string;
  password: string;
  error: string | null;
  isSubmitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onOpenTotem?: () => void;
}

export function AdminLoginScreen({
  routeMode,
  theme,
  onToggleTheme,
  email,
  password,
  error,
  isSubmitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onOpenTotem,
}: AdminLoginScreenProps) {
  return (
    <div
      id="admin-login-screen"
      className="saas-shell relative flex min-h-dvh w-full items-center justify-center bg-background p-4 text-foreground"
    >
      <div className="absolute top-4 right-4">
        <ThemeToggleButton theme={theme} onToggleTheme={onToggleTheme} />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            {routeMode === 'operator'
              ? 'Operação do Estande'
              : 'Painel Administrativo do Quiz'}
          </h1>
          <CardDescription>
            Acesso autenticado para a Equipe do Estande (Administrador e Operador).
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-login-email">E-mail</Label>
              <Input
                id="admin-login-email"
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="admin@caesb.df.gov.br"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-login-password">Senha</Label>
              <Input
                id="admin-login-password"
                type="password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <Button id="admin-login-submit" type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
                {isSubmitting ? 'Autenticando...' : 'Entrar'}
              </Button>
              {onOpenTotem && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onOpenTotem}
                  className="w-full sm:w-auto"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar ao Totem
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
