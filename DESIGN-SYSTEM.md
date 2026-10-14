# Tanesco Digital – Design System (aus tanescodigital.de extrahiert)

Stack der Seite: Tailwind CSS v4 (Farben in OKLCH), Font Inter, Icons im Lucide-Stil.
Werte unten sind die tatsächlich berechneten Styles der Live-Seite.

## Gesamteindruck
Clean, hell, viel Weißraum, „Premium-SaaS“-Look mit kräftigem Rot als einziger Akzentfarbe.
Sehr fette Headlines (900), weiche Schatten, große Radien, dezente Glas-/Blur-Effekte,
Rot-Verläufe auf CTAs, Sektionen wechseln zwischen Weiß → Dunkel-Navy → Vollflächig Rot.
Sanfte Fade-in/Blur-Animationen beim Scrollen.

## Farben
| Token | Wert | Hex ca. | Verwendung |
|---|---|---|---|
| primary | oklch(0.5 0.25 25) | #BC001D | Buttons, Akzentwörter, Icons |
| primary-light | oklch(0.637 0.237 25.3) (Tailwind red-500) | #FB2C36 | Verlaufsende |
| primary-soft | primary / 10 % Deckkraft | – | Badge-/Icon-Hintergründe |
| primary-border | primary / 20–30 % | – | Badge-Rahmen, Kartenrahmen |
| accent-on-dark | red-400 | #FF6467 | Rote Texte auf dunklem Grund |
| text-heading | oklch(0.235 0.015 65) | #231D17 | Headlines (warmes Fast-Schwarz) |
| text-strong | gray-900 | #101828 | Titel, starke Texte |
| text-body | gray-600 | #4A5565 | Fließtext |
| text-muted | gray-500 / gray-400 | #6A7282 / #99A1AF | Untertitel, Meta |
| border | gray-200 / gray-100 | #E5E7EB / #F3F4F6 | Karten, Header-Linie |
| bg | white / gray-50 | #FFFFFF / #F9FAFB | Seiten- & Karten-Hintergrund |
| dark-section | Verlauf gray-900 → gray-700 | #101828 → #364153 | Dunkle Sektionen |
| success | emerald-600 | #009966 | WhatsApp-Button, Erfolg |

Verläufe:
- CTA: `linear-gradient(to right, primary, primary-light)`
- Icon-Kacheln: `linear-gradient(to bottom right, primary, primary-light)`
- Dunkle Sektion: `linear-gradient(to right, #101828, #364153)` + große, weichgezeichnete rote Glow-Kreise im Hintergrund
- Rote Sektion: vollflächig primary mit leichtem radialem Aufhellen

## Typografie (Inter, system-ui Fallback)
| Element | Größe / Gewicht / Zeilenhöhe |
|---|---|
| H1 Hero | 72px / 900 / 1.1 – zweizeilig, erste Zeile in Rot |
| H2 Sektion | 60px / 900 / 1.25 – Muster: „Unsere **Lead-Kategorien**“ (zweiter Teil rot) |
| H3 groß | 30px / 900 |
| Kartentitel | 18–20px / 700 |
| Lead / Subline | 20–24px / 500, gray-600, zentriert |
| Body | 16px / 400 |
| UI / Nav / Buttons | 14px / 500 |
| Badges, Meta | 12px / 600–700 |
Mobile: H1 ca. 36–48px, H2 ca. 36px.

## Radien
- Buttons klein (Nav): 8px
- Buttons groß (CTA): 14px
- Karten / Icon-Kacheln: 16px, große Karten 24px
- Badges/Pills & runde Buttons: voll gerundet (9999px)

## Schatten
- CTA rot: `0 8px 30px rgba(220,38,38,0.30)`
- Sekundärbutton: `0 4px 20px rgba(0,0,0,0.05)`
- Karten / schwebende Elemente: `0 8px 30px rgba(0,0,0,0.12)`
- Generell weich, großflächig, nie hart.

## Komponenten
**Header**: weiß, sticky, 1px Unterkante gray-100, Logo links, Nav-Links 14px/500 gray-900,
rechts Outline-Button („Für Privatkunden“, weiß, 1px gray-200, r 8px) + Primär-Button (rot, weiß, r 8px, padding 8×16).

**Primär-CTA**: Rot-Verlauf, weißer Text 18px/500, padding 0×40 (Höhe ~56px), r 14px, roter Glow-Schatten, Pfeil-Icon rechts.

**Sekundär-CTA**: weiß 80 % mit Blur, 2px Rahmen gray-200, Text dunkel, r 14px, Icon rechts.

**Badge / Eyebrow** (über Headlines): Pill, bg primary/10, 1px Rahmen primary/20, roter Punkt + Icon + Text 12–14px/600 rot.

**Trust-Chips** (unter CTAs): weiße Pills mit rotem Check-Icon, 12px Text.

**Feature-/Kategorie-Karte**: weiß, r 24px, 1px gray-100, weicher Schatten, oben rechts rote Mini-Pill („Premium“), zentrierte Icon-Kachel (weiß, r 16px, Schatten, farbiges Icon), Titel 20px/700, Subline gray-500, Liste als hellgraue Zeilen (gray-50, r 12px) mit rotem Check-Kreis, unten volle Breite Rot-Verlaufs-Button.

**Karte auf Dunkel**: bg weiß 5–10 %, 1px weiß/10 %, r 16–24px, Icon-Kachel mit rotem Tint, Text weiß/gray-300, Footer-Zeile mit rotem Check + red-400 Text.

**Floating Icons** (Hero): kleine weiße r-16-Kacheln mit Schatten und farbigem Icon, leicht schwebend animiert.

**Sonstiges**: runder roter „nach oben“-Button unten links, grüner WhatsApp-Button unten rechts; Karussell-Pfeile als weiße r-16-Quadrate mit Schatten.

## Layout & Abstände
- Container max. ~1280px (Tailwind max-w-7xl), seitlich 16–32px
- Sektionen: 96–128px Abstand oben/unten, Inhalt meist zentriert
- Grids: 3 Spalten Desktop, Gap 24–32px
- Hero: Vollbild mit hellem, stark aufgehelltem Foto + weißem Verlauf darüber

## Tailwind-Kurzfassung (zum direkten Übernehmen)
```css
@theme {
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --color-primary: oklch(0.5 0.25 25);
  --color-primary-light: oklch(0.637 0.237 25.331);
  --color-heading: oklch(0.235 0.015 65);
  --radius-btn: 0.875rem;   /* 14px */
  --radius-card: 1.5rem;    /* 24px */
  --shadow-cta: 0 8px 30px rgb(220 38 38 / 0.3);
  --shadow-card: 0 8px 30px rgb(0 0 0 / 0.12);
}
```
Neutrals = Tailwind `gray`, Erfolg = `emerald`.
