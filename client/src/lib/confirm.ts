/**
 * Bestätigen und Nachfragen in einem eigenen, zum Design passenden Dialog – statt window.confirm/prompt,
 * die in eingebetteten Ansichten (z. B. Chat-Build) still abgelehnt werden.
 */
function mount(kind: "confirm" | "prompt", message: string, options: { confirmLabel?: string; cancelLabel?: string; danger?: boolean; defaultValue?: string; placeholder?: string }): Promise<boolean | string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div"); backdrop.className = "app-confirm-backdrop"; backdrop.setAttribute("role", "presentation");
    const dialog = document.createElement("div"); dialog.className = "app-confirm"; dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.setAttribute("aria-label", message);
    const text = document.createElement("p"); text.className = "app-confirm-text"; text.textContent = message;
    dialog.append(text);
    let input: HTMLInputElement | null = null;
    if (kind === "prompt") { input = document.createElement("input"); input.className = "app-confirm-input"; input.value = options.defaultValue ?? ""; input.placeholder = options.placeholder ?? ""; dialog.append(input); }
    const actions = document.createElement("div"); actions.className = "app-confirm-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "app-confirm-cancel"; cancel.textContent = options.cancelLabel ?? "Abbrechen";
    const ok = document.createElement("button"); ok.type = "button"; ok.className = `app-confirm-ok${options.danger ? " danger" : ""}`; ok.textContent = options.confirmLabel ?? (kind === "prompt" ? "Übernehmen" : "Ja, fortfahren");
    actions.append(cancel, ok); dialog.append(actions); backdrop.append(dialog); document.body.append(backdrop);
    const finish = (value: boolean | string | null) => { window.removeEventListener("keydown", onKey); backdrop.remove(); resolve(value); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") finish(kind === "prompt" ? null : false); if (event.key === "Enter" && kind === "prompt") finish(input?.value ?? ""); };
    window.addEventListener("keydown", onKey);
    cancel.onclick = () => finish(kind === "prompt" ? null : false);
    ok.onclick = () => finish(kind === "prompt" ? (input?.value ?? "") : true);
    backdrop.onclick = (event) => { if (event.target === backdrop) finish(kind === "prompt" ? null : false); };
    (input ?? ok).focus();
  });
}

/** Ja/Nein-Frage; `danger` färbt den Bestätigen-Knopf rot (Löschen). */
export function confirmAction(message: string, options: { confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  const danger = options.danger ?? /löschen|entfernen|deaktivieren|verwerfen|zurücksetzen/i.test(message);
  return mount("confirm", message, { ...options, danger, confirmLabel: options.confirmLabel ?? (danger ? "Ja, löschen" : undefined) }) as Promise<boolean>;
}

/** Texteingabe; liefert null bei Abbruch. */
export function promptAction(message: string, defaultValue = "", placeholder = ""): Promise<string | null> {
  return mount("prompt", message, { defaultValue, placeholder }) as Promise<string | null>;
}
