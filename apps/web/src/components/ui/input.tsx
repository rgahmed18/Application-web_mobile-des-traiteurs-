import * as React from 'react';
import { cn } from 'cn';

/** Montants et quantités : saisie au clavier numérique. */
const NUMERIC_INPUT_MODES = new Set(['decimal', 'numeric']);

function Input({
  className,
  type,
  inputMode,
  autoComplete,
  onFocus,
  onMouseUp,
  ...props
}: React.ComponentProps<'input'>) {
  const numeric = inputMode !== undefined && NUMERIC_INPUT_MODES.has(inputMode);
  // Sélection posée au focus : le clic qui l'a donné ne doit pas la retirer en relâchant
  const keepSelection = React.useRef(false);
  return (
    <input
      type={type}
      inputMode={inputMode}
      // Montants et quantités : pas de valeurs proposées par le navigateur (une suggestion
      // acceptée par erreur fausse un prix)
      autoComplete={autoComplete ?? (numeric ? 'off' : undefined)}
      onFocus={(event) => {
        onFocus?.(event);
        // Champ déjà rempli : la saisie remplace la valeur au lieu de s'ajouter au bout
        // (« 10 » tapé dans « 10 » ne doit jamais donner « 1010 »)
        if (numeric && event.currentTarget.value !== '') {
          event.currentTarget.select();
          keepSelection.current = true;
        }
      }}
      onMouseUp={(event) => {
        onMouseUp?.(event);
        if (keepSelection.current) {
          keepSelection.current = false;
          event.preventDefault();
        }
      }}
      data-slot="input"
      className={cn(
        'h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
