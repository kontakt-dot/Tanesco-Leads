import { useDialogComposition } from "@/components/ui/dialog";
import { useComposition } from "@/hooks/useComposition";
import { cn } from "@/lib/utils";
import * as React from "react";

/**
 * Kann der Browser Text per CSS als Punkte zeigen? (Chrome, Edge, Safari: ja.) Dann wird aus einem Feld für Zugangsdaten
 * ein Textfeld mit Punkten – der Passwort-Manager des Browsers kennt es nicht, setzt nichts ein und will nichts speichern.
 */
export function canMaskText() {
  try {
    const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
    return typeof css?.supports === "function" && css.supports("-webkit-text-security", "disc");
  } catch {
    return false;
  }
}

/** Passwort-Manager als Erweiterung (1Password, LastPass, Bitwarden …) sollen hier ebenfalls nichts einsetzen. */
const IGNORE_PASSWORD_MANAGERS = { "data-1p-ignore": "true", "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" } as const;

/**
 * Eingabefeld. `type="password"` ohne eigenes `autoComplete` ist ein Geheimnis für ein ANDERES System (Zugang eines Partners,
 * API-Schlüssel, Postfach-Passwort, neues Passwort für einen Benutzer) – nie die eigene Anmeldung (die hat ihr eigenes Feld mit
 * `autoComplete="current-password"`). Der Browser soll dort nichts einsetzen: Sonst steht z. B. das gespeicherte Passwort für diese
 * Software im Feld „user“ eines Partners und geht bei jeder Anmeldung dorthin. Darum: Textfeld mit Punkten, wo der Browser das kann,
 * sonst Passwortfeld mit „new-password“; ohne Rechtschreibprüfung (die schickt Text sonst u. U. an einen Dienst). `reveal` zeigt den Wert lesbar.
 */
function Input({
  className,
  type,
  reveal,
  style,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: React.ComponentProps<"input"> & { /** nur bei `type="password"`: Wert lesbar zeigen (Auge) */ reveal?: boolean }) {
  const secret = type === "password" && props.autoComplete === undefined;
  const masked = secret && !reveal;
  const cssMask = masked && canMaskText();
  const secretProps = secret
    ? { ...IGNORE_PASSWORD_MANAGERS, "data-secret": masked ? "masked" : "shown", autoComplete: masked && !cssMask ? "new-password" : "off", spellCheck: false, autoCapitalize: "off", autoCorrect: "off" }
    : {};
  const effectiveType = !secret ? type : masked && !cssMask ? "password" : "text";
  const effectiveStyle = cssMask ? ({ ...style, WebkitTextSecurity: "disc" } as React.CSSProperties) : style;
  // Get dialog composition context if available (will be no-op if not inside Dialog)
  const dialogComposition = useDialogComposition();

  // Add composition event handlers to support input method editor (IME) for CJK languages.
  const {
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    onKeyDown: handleKeyDown,
  } = useComposition<HTMLInputElement>({
    onKeyDown: (e) => {
      // Check if this is an Enter key that should be blocked
      const isComposing = (e.nativeEvent as any).isComposing || dialogComposition.justEndedComposing();

      // If Enter key is pressed while composing or just after composition ended,
      // don't call the user's onKeyDown (this blocks the business logic)
      if (e.key === "Enter" && isComposing) {
        return;
      }

      // Otherwise, call the user's onKeyDown
      onKeyDown?.(e);
    },
    onCompositionStart: e => {
      dialogComposition.setComposing(true);
      onCompositionStart?.(e);
    },
    onCompositionEnd: e => {
      // Mark that composition just ended - this helps handle the Enter key that confirms input
      dialogComposition.markCompositionEnd();
      // Delay setting composing to false to handle Safari's event order
      // In Safari, compositionEnd fires before the ESC keydown event
      setTimeout(() => {
        dialogComposition.setComposing(false);
      }, 100);
      onCompositionEnd?.(e);
    },
  });

  return (
    <input
      {...props}
      {...secretProps}
      type={effectiveType}
      style={effectiveStyle}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
    />
  );
}

export { Input };
