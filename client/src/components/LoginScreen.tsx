import { TanescoLogo } from "@/components/TanescoLogo";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useState } from "react";

/** Anmeldung mit E-Mail und Passwort; Konto anlegen für den ersten Benutzer, bei offener Registrierung oder mit Einladungslink. */
export default function LoginScreen() {
  const utils = trpc.useUtils();
  const inviteToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("invite") : null;
  const status = trpc.auth.registrationStatus.useQuery(undefined, { retry: false });
  const canRegister = Boolean(status.data?.open || inviteToken);
  const [mode, setMode] = useState<"login" | "register">(inviteToken ? "register" : "login");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null);
  const login = trpc.auth.login.useMutation({ onSuccess: () => utils.auth.me.invalidate(), onError: (e) => setError(e.message) });
  const register = trpc.auth.register.useMutation({ onSuccess: () => utils.auth.me.invalidate(), onError: (e) => setError(e.message) });
  const pending = login.isPending || register.isPending;
  const submit = () => { setError(null); if (mode === "login") login.mutate({ email, password }); else register.mutate({ name, email, password, inviteToken: inviteToken ?? undefined }); };
  const effectiveMode = canRegister ? mode : "login";
  return <main className="min-h-screen grid place-items-center bg-[#121322] px-5 text-white login-screen"><section className="surface-panel w-full max-w-md p-8">
    <div className="mx-auto mb-5 flex justify-center"><TanescoLogo /></div>
    <span className="eyebrow block text-center">GESCHÜTZTER BEREICH</span>
    <h1 className="mt-3 text-center text-2xl font-semibold">Tanesco Leads</h1>
    <p className="mt-2 text-center text-sm text-slate-400">{effectiveMode === "login" ? "Melden Sie sich mit E-Mail-Adresse und Passwort an." : status.data?.firstUser ? "Legen Sie das erste Konto an. Es erhält alle Rechte." : inviteToken ? "Sie wurden eingeladen. Legen Sie Ihr Konto an, um beizutreten." : "Konto anlegen."}</p>
    {canRegister && <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-white/[.04] p-1 text-xs"><button className={`rounded-md px-3 py-2 ${effectiveMode === "login" ? "bg-white/10 text-white" : "text-slate-400"}`} onClick={() => setMode("login")}>Anmelden</button><button className={`rounded-md px-3 py-2 ${effectiveMode === "register" ? "bg-white/10 text-white" : "text-slate-400"}`} onClick={() => setMode("register")}>Konto erstellen</button></div>}
    <form className="mt-5 grid gap-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {effectiveMode === "register" && <label className="text-xs text-slate-300">Name<input className="mt-1 w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-white" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>}
      <label className="text-xs text-slate-300">E-Mail-Adresse<input className="mt-1 w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-white" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <label className="text-xs text-slate-300">Passwort<input className="mt-1 w-full rounded-md border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-white" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={effectiveMode === "login" ? "current-password" : "new-password"} required /></label>
      {effectiveMode === "register" && <p className="text-[11px] text-slate-500">Mindestens 10 Zeichen, Buchstaben und eine Ziffer.</p>}
      {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
      <Button className="flux-button mt-2 w-full" type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : effectiveMode === "login" ? "Anmelden" : "Konto erstellen"}</Button>
    </form>
    {!canRegister && status.data && <p className="mt-4 text-center text-[11px] text-slate-500">Neue Zugänge werden per Einladungslink angelegt.</p>}
  </section></main>;
}
