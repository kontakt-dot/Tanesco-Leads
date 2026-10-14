import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export default function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [repeat, setRepeat] = useState("");
  const change = trpc.auth.changePassword.useMutation({ onSuccess: () => { toast.success("Passwort geändert."); onClose(); }, onError: (error) => toast.error(error.message) });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}><section className="surface-panel w-full max-w-sm p-6" onClick={(event) => event.stopPropagation()}>
    <span className="eyebrow">ZUGANG</span><h2 className="mt-1 text-lg text-slate-100">Passwort ändern</h2>
    <form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); if (next !== repeat) return toast.error("Die Wiederholung stimmt nicht überein."); change.mutate({ currentPassword: current, newPassword: next }); }}>
      <label className="text-xs text-slate-300">Aktuelles Passwort<input className="mt-1 w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-white" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required /></label>
      <label className="text-xs text-slate-300">Neues Passwort<input className="mt-1 w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-white" type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" required /></label>
      <label className="text-xs text-slate-300">Neues Passwort wiederholen<input className="mt-1 w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-white" type="password" value={repeat} onChange={(event) => setRepeat(event.target.value)} autoComplete="new-password" required /></label>
      <div className="mt-2 flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={onClose}>Abbrechen</Button><Button className="flux-button" size="sm" type="submit" disabled={change.isPending}>Speichern</Button></div>
    </form>
  </section></div>;
}
