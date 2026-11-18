import { Button } from "@/components/ui/button";
import { fileToAvatarDataUrl } from "@/lib/avatar-image";
import { trpc } from "@/lib/trpc";
import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Inhalt eines Avatar-Kreises: das Profilbild – oder die Initialen, wenn es keines gibt (oder es nicht lädt). */
export function AvatarContent({ avatarUrl, initials }: { avatarUrl?: string | null; initials: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [avatarUrl]);
  return avatarUrl && !broken ? <img className="avatar-img" src={avatarUrl} alt="" decoding="async" draggable={false} onError={() => setBroken(true)} /> : <>{initials}</>;
}

/** Profilbilder aller Benutzer des Mandanten (einmal geladen, kurz gemerkt): Benutzer → Adresse. */
export function useAvatarOf(): (userId: number | null | undefined) => string | null {
  const directory = trpc.leadops.avatarDirectory.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const map = new Map((directory.data ?? []).map((row) => [row.userId, row.avatarUrl] as const));
  return (userId) => (userId ? map.get(userId) ?? null : null);
}
/** Kürzel-Kreis eines Vertrieblers/Agenten (TA, FR …) – zeigt das Profilbild, wenn eines hochgeladen ist. */
export function OwnerDot({ userId, initials, avatarUrl, className = "", title }: { userId?: number | null; initials: string; avatarUrl?: string | null; className?: string; title?: string }) {
  const avatarOf = useAvatarOf(); const url = avatarUrl ?? avatarOf(userId);
  return <span className={`owner-dot ${className}`.trim()} title={title}><AvatarContent avatarUrl={url} initials={initials} /></span>;
}

/** Datei wählen → klein rechnen → übergeben. Liefert das unsichtbare Eingabefeld und „öffnen“. */
export function useAvatarPicker(onPick: (dataUrl: string) => void) {
  const inputRef = useRef<HTMLInputElement>(null); const [working, setWorking] = useState(false);
  const choose = async (file: File | undefined) => {
    if (!file) return; setWorking(true);
    try { onPick(await fileToAvatarDataUrl(file)); } catch (error) { toast.error(error instanceof Error ? error.message : "Das Bild konnte nicht gelesen werden."); } finally { setWorking(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  const input = <input ref={inputRef} className="avatar-file" type="file" accept="image/*" hidden aria-hidden="true" tabIndex={-1} onChange={(event) => { void choose(event.target.files?.[0]); }} />;
  return { input, open: () => inputRef.current?.click(), working };
}

/** Eigenes Profilbild setzen oder entfernen – danach ist es überall sofort zu sehen (oben rechts, Benutzerliste, Pipeline). */
export function useOwnAvatar() {
  const utils = trpc.useUtils();
  const refresh = () => { utils.auth.me.invalidate(); utils.leadops.avatarDirectory.invalidate(); utils.leadops.listMembers.invalidate(); utils.leadops.getMemberDetail.invalidate(); utils.leadops.pipelineOwners.invalidate(); };
  const save = trpc.auth.setAvatar.useMutation({ onSuccess: (result) => { toast.success(result.avatarUrl ? "Profilbild gespeichert." : "Profilbild entfernt."); refresh(); }, onError: (error) => toast.error(error.message) });
  return { set: (dataUrl: string) => save.mutate({ dataUrl }), remove: () => save.mutate({ dataUrl: null }), busy: save.isPending };
}

/**
 * Profilbild mit Hochladen: Klick auf den Kreis (oder den Knopf) öffnet die Dateiauswahl. Das Foto wird automatisch
 * quadratisch zugeschnitten und klein gerechnet.
 */
export default function AvatarUpload({ initials, avatarUrl, onPick, onRemove, busy = false, size = 76, compact = false, label = "Profilbild" }: { initials: string; avatarUrl?: string | null; onPick: (dataUrl: string) => void; onRemove: () => void; busy?: boolean; size?: number; compact?: boolean; label?: string }) {
  const picker = useAvatarPicker(onPick); const disabled = busy || picker.working;
  return <div className={`avatar-upload ${compact ? "is-compact" : ""}`}>
    <button type="button" className="avatar-upload-pic" style={{ ["--pic" as string]: `${size}px` }} title={avatarUrl ? `${label} ändern` : `${label} hochladen`} aria-label={avatarUrl ? `${label} ändern` : `${label} hochladen`} disabled={disabled} onClick={picker.open}>
      <span className="avatar-upload-face"><AvatarContent avatarUrl={avatarUrl} initials={initials} /></span>
      <span className="avatar-upload-badge" aria-hidden="true"><Camera /></span>
    </button>
    {picker.input}
    <div className="avatar-upload-actions">
      {!compact && <Button size="sm" variant="outline" className="avatar-upload-choose" disabled={disabled} onClick={picker.open}>{disabled ? "Lädt …" : avatarUrl ? "Anderes Bild wählen" : `${label} hochladen`}</Button>}
      {avatarUrl && <button type="button" className="avatar-upload-remove" disabled={disabled} onClick={onRemove}>{compact ? "Bild entfernen" : "Entfernen"}</button>}
      {!compact && <small>Foto als JPG oder PNG – es wird automatisch rund zugeschnitten.</small>}
    </div>
  </div>;
}
