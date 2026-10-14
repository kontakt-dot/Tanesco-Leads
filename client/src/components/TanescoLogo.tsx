/**
 * Tanesco-Logo (Bildmarke + Schriftzug) als Vektorgrafik aus client/public/brand – gestochen scharf in jeder Größe.
 * Heller Modus: Original (schwarz mit rotem Balken); dunkler Modus: rein weiß. Umschaltung per CSS (html.dark).
 */
export function TanescoLogo({ variant = "full", className, logoUrl }: { variant?: "full" | "mark"; className?: string; logoUrl?: string | null }) {
  if (logoUrl) return <img src={logoUrl} alt="Logo" className={`custom-logo ${className ?? ""}`} style={{ height: variant === "mark" ? 36 : 52, maxWidth: variant === "mark" ? 44 : 190, width: "auto", objectFit: "contain" }} />;
  if (variant === "mark") return <>
    <img src="/brand/tanesco-mark.svg" alt="Tanesco" className={`logo-light ${className ?? ""}`} style={{ height: 36, width: "auto" }} />
    <img src="/brand/tanesco-mark-white.svg" alt="Tanesco" className={`logo-dark ${className ?? ""}`} style={{ height: 36, width: "auto" }} />
  </>;
  return <>
    <img src="/brand/tanesco-logo.svg" alt="Tanesco" className={`logo-light ${className ?? ""}`} style={{ height: 58, width: "auto" }} />
    <img src="/brand/tanesco-logo-white.svg" alt="Tanesco" className={`logo-dark ${className ?? ""}`} style={{ height: 58, width: "auto" }} />
  </>;
}
