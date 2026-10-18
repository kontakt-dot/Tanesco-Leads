"""Erzeugt client/src/theme-light.css aus den dunklen Stylesheets: nur Farben, kein Layout."""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = [ROOT / "client/src/index.css", ROOT / "client/src/lead-refinements.css", ROOT / "client/src/automation-refinements.css"]

# Heller Modus „Tanesco Light“: weiße Flächen, hauchdünne Linien, kaum Grau. Akzent = Schwarz (Knöpfe, aktive Navigation,
# Labels, Hervorhebungen); Rot bleibt Fehlern/Warnungen vorbehalten; dezente grüne Elemente für Positives (Balken, Auswahl).
TEXT_DARK = "#0f172a"; TEXT_MID = "#4b5568"; TEXT_MUTED = "#8a94a6"
SURFACE = "#ffffff"; SURFACE_SOFT = "#f8fafb"; SURFACE_SOFTER = "#f3f6f8"; PAGE = "#ffffff"; BORDER = "#e8ecf1"; BORDER_STRONG = "#d9dfe7"
ACCENT_TEXT = "#111318"; ACCENT = "#111318"; ACCENT_DEEP = "#000000"; ACCENT_LIGHT = "#2a2e3a"
ACCENT_TINT = "#f3f6f8"; ACCENT_BORDER = "#d9dfe7"
INK = "#111318"; INK_LIGHT = "#2a2e3a"; INK_TINT = "rgba(15, 23, 42, .06)"; INK_BORDER = "rgba(15, 23, 42, .45)"  # Schwarz/Anthrazit als Akzent für Verläufe/Auswahl
GRADIENT_SOLID = f"linear-gradient(135deg, {ACCENT_LIGHT}, {ACCENT})"  # Knöpfe/feste Flächen: dunkler Verlauf
GRADIENT_BRAND = "linear-gradient(180deg, rgb(var(--acc1)), rgb(var(--acc2)))"  # Diagrammbalken: Farbwelt (Einstellungen → Ansicht)
GRADIENT_TINT = "linear-gradient(135deg, rgba(var(--acc1), .14), rgba(var(--acc2), .10))"  # zarte Akzentverläufe (Hervorhebungen, Kopfbereiche)
GRADIENT_SURFACE = "linear-gradient(180deg, #ffffff, #f6f8fc)"  # dunkle Flächenverläufe → Weiß zu Hauchgrau
PAGE_WASH = "radial-gradient(circle at 92% -8%, rgba(var(--acc1), .16), transparent 30rem), radial-gradient(circle at -8% 108%, rgba(var(--acc2), .14), transparent 28rem), linear-gradient(130deg, #ffffff, #f8fafc 55%, #f3f6fa)"

def parse_color(token):
    token = token.strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})", token)
    if m:
        h = m.group(1)
        if len(h) in (3, 4): h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    m = re.fullmatch(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)", token)
    if m:
        r, g, b = (float(m.group(i)) for i in (1, 2, 3)); a = float(m.group(4)) if m.group(4) else 1.0
        return r, g, b, a
    if token == "white": return 255, 255, 255, 1.0
    if token == "black": return 0, 0, 0, 1.0
    return None

def luminance(c): r, g, b = (v / 255 for v in c[:3]); return 0.2126 * r + 0.7152 * g + 0.0722 * b
def saturation(c): return max(c[:3]) - min(c[:3])
COLOR_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b")

RED_TEXT = ACCENT_TEXT; RED_SOLID = ACCENT; RED_DEEP = ACCENT_DEEP  # (Namen historisch: Akzentfarben)
def is_violet(c):
    import colorsys
    hh, ll, ss = colorsys.rgb_to_hls(c[0] / 255, c[1] / 255, c[2] / 255)
    return ss > 0.45 and 0.6 <= hh <= 0.85 and 0.3 <= ll <= 0.86  # nur die Akzent-Violetts, keine dunklen Flächen / hellen Texte

def darken_accent(c, factor=0.55):
    if is_violet(c): return RED_TEXT
    r, g, b, _ = c
    return "#%02x%02x%02x" % (int(r * factor), int(g * factor), int(b * factor))

def map_text(value):
    """Helle Textfarben → dunkel; gesättigte Akzente → abgedunkelt; dunkle Farben bleiben."""
    def repl(m):
        c = parse_color(m.group(0))
        if not c: return m.group(0)
        lum = luminance(c)
        if is_violet(c): return RED_TEXT
        if saturation(c) > 70 and lum > 0.45: return darken_accent(c)
        if lum > 0.82: return TEXT_DARK
        if lum > 0.62: return TEXT_MID
        if lum > 0.45: return TEXT_MUTED
        return m.group(0)
    return COLOR_RE.sub(repl, value)

def map_background(selector, value):
    """Dunkle Flächen → weiß; halbtransparente Weiß-/Schwarzschleier → sehr helle Grautöne; Verläufe → flach."""
    colors = [parse_color(m.group(0)) for m in COLOR_RE.finditer(value)]
    colors = [c for c in colors if c]
    if not colors: return None
    if "gradient" in value:
        if ".flux-button" in selector or ".flux-btn" in selector: return GRADIENT_SOLID
        if ".flux-shell" in selector or "body" in selector: return PAGE_WASH
        if any(is_violet(c) and c[3] >= 0.6 for c in colors): return GRADIENT_SOLID  # kräftige Akzentverläufe (Balken, Knöpfe)
        if any(is_violet(c) for c in colors): return GRADIENT_TINT  # zarte Akzentverläufe (aktive Navigation, Hervorhebungen)
        return GRADIENT_SURFACE  # dunkle Flächenverläufe → weißer Hauch
    if len(colors) == 1 and is_violet(colors[0]):
        a = colors[0][3]
        if a < 0.12: return SURFACE_SOFT  # violette Hauchflächen → neutral hell
        return ACCENT_TINT if a < 0.6 else ACCENT
    if len(colors) == 1:
        c = colors[0]; r, g, b, a = c
        if r > 240 and g > 240 and b > 240 and a < 0.3: return SURFACE_SOFT if a > 0.04 else SURFACE_SOFT
        if r < 40 and g < 40 and b < 40 and a < 0.7: return SURFACE_SOFTER
        if luminance(c) < 0.45:
            if ".flux-shell" in selector: return PAGE_WASH
            if saturation(c) > 60 and a > 0.5: return darken_accent(c, 0.9)  # gesättigte Akzentflächen bleiben (leicht kräftiger)
            return SURFACE
    return None

def map_border(value):
    def repl(m):
        c = parse_color(m.group(0))
        if not c: return m.group(0)
        r, g, b, a = c
        if r > 240 and g > 240 and b > 240: return BORDER_STRONG if a > 0.3 else BORDER
        if is_violet(c): return BORDER if a < 0.3 else (ACCENT_BORDER if a < 1 else ACCENT)
        if luminance(c) < 0.45 and saturation(c) < 40: return BORDER
        return m.group(0)
    return COLOR_RE.sub(repl, value)

def map_shadow(value):
    return re.sub(r"rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b", "rgba(15, 23, 42, .05)", value) if value else value

def iter_rules(css):
    """Einfacher CSS-Parser: Regeln außerhalb von @media/@keyframes (Layer-Blöcke werden übersprungen)."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    depth = 0; i = 0; buf = ""; stack = []
    while i < len(css):
        ch = css[i]
        if ch == "{":
            head = buf.strip(); buf = ""; stack.append(head); depth += 1
        elif ch == "}":
            body = buf.strip(); buf = ""; head = stack.pop(); depth -= 1
            if head and not head.startswith("@") and all(not h.startswith("@") or h.startswith("@media") for h in stack):
                media = next((h for h in stack if h.startswith("@media")), None)
                yield head, body, media
        else:
            buf += ch
        i += 1

def convert():
    out = ["/* Automatisch erzeugt (scripts/build-light-theme.py): heller Modus – nur Farben, Layout unverändert. */"]
    out.append(f"html:not(.dark) {{ --background: #ffffff; --foreground: {TEXT_DARK}; --card: #ffffff; --card-foreground: {TEXT_DARK}; --popover: #ffffff; --popover-foreground: {TEXT_DARK}; --primary: {ACCENT}; --primary-foreground: #ffffff; --secondary: {SURFACE_SOFT}; --secondary-foreground: {TEXT_DARK}; --muted: {SURFACE_SOFT}; --muted-foreground: {TEXT_MID}; --accent: {SURFACE_SOFT}; --accent-foreground: {TEXT_DARK}; --destructive: #dc2626; --destructive-foreground: #ffffff; --border: {BORDER}; --input: {BORDER_STRONG}; --ring: {ACCENT}; color-scheme: light; }}")
    out.append(f"html:not(.dark) body {{ background: #ffffff; color: {TEXT_DARK}; }}")
    out.append('html:not(.dark) input[type="date"], html:not(.dark) input[type="time"], html:not(.dark) input[type="datetime-local"], html:not(.dark) input[type="month"], html:not(.dark) input[type="week"] { color-scheme: light; } html:not(.dark) input[type="date"]::-webkit-calendar-picker-indicator, html:not(.dark) input[type="time"]::-webkit-calendar-picker-indicator, html:not(.dark) input[type="datetime-local"]::-webkit-calendar-picker-indicator, html:not(.dark) input[type="month"]::-webkit-calendar-picker-indicator, html:not(.dark) input[type="week"]::-webkit-calendar-picker-indicator { filter: none !important; }')
    seen = set()
    for source in SOURCES:
        if not source.exists(): continue
        for selector, body, media in iter_rules(source.read_text()):
            decls = []
            for decl in body.split(";"):
                if ":" not in decl: continue
                prop, value = decl.split(":", 1); prop = prop.strip().lower(); value = value.strip()
                value = value.replace("!important", "").strip(); important = " !important"
                if prop in ("background", "background-color", "background-image"):
                    mapped = map_background(selector, value)
                    if mapped: decls.append(f"{prop}: {mapped}{important}")
                elif prop == "color":
                    mapped = map_text(value)
                    if mapped != value: decls.append(f"color: {mapped}{important}")
                elif prop.startswith("border") and prop not in ("border-radius", "border-width", "border-style", "border-collapse", "border-spacing") and ("rgba(255" in value or "rgba(0" in value or "#" in value or "rgba(1" in value or "rgba(2" in value):
                    mapped = map_border(value)
                    if mapped != value: decls.append(f"{prop}: {mapped}{important}")
                elif prop == "box-shadow" and ("rgba(" in value or "#" in value):
                    decls.append(f"box-shadow: {map_shadow(value)}{important}")
                elif prop in ("fill", "stroke"):
                    mapped = map_text(value)
                    if mapped != value: decls.append(f"{prop}: {mapped}{important}")
            if not decls: continue
            scoped = ", ".join(f"html:not(.dark) {part.strip()}" for part in selector.split(",") if part.strip())
            rule = f"{scoped} {{ {'; '.join(decls)}; }}"
            if media: rule = f"{media} {{ {rule} }}"
            if rule in seen: continue
            seen.add(rule); out.append(rule)
    # Tailwind-Farbklassen aus dem JSX: Flächen, Text, Rahmen, Knöpfe, Badges
    tw = {
        ".bg-slate-900, .bg-slate-950, .bg-\\[\\#0b0c1e\\]": "background-color: #ffffff !important;",
        ".bg-slate-800, .bg-white\\/\\[\\.015\\], .bg-white\\/\\[\\.018\\], .bg-white\\/\\[\\.02\\], .bg-white\\/\\[\\.03\\], .bg-white\\/\\[\\.035\\], .bg-white\\/\\[\\.04\\], .bg-white\\/5, .bg-white\\/10, .bg-slate-950\\/15, .bg-slate-950\\/25, .bg-slate-950\\/30, .bg-slate-950\\/35, .bg-slate-950\\/40, .bg-slate-950\\/60, .bg-slate-900\\/60, .bg-slate-900\\/70, .bg-slate-500\\/10": f"background-color: {SURFACE_SOFT} !important;",
        ".bg-black\\/20, .bg-black\\/30, .bg-black\\/40": f"background-color: {SURFACE_SOFTER} !important;",
        "select, input:not([type=\"checkbox\"]):not([type=\"radio\"]):not([type=\"file\"]), textarea": f"background-color: #ffffff !important; color: {TEXT_DARK} !important; border-color: {BORDER_STRONG} !important;",
        ".border-slate-400\\/25, .border-slate-500\\/25, .border-slate-500\\/30": f"border-color: {BORDER_STRONG} !important;",
        ".text-white:not(.flux-button):not([data-keep-white]), .text-slate-50, .text-slate-100, .text-slate-200": f"color: {TEXT_DARK} !important;",
        ".text-slate-300": "color: #2b3446 !important;",
        ".text-slate-400": f"color: {TEXT_MID} !important;",
        ".text-slate-500, .text-slate-600": f"color: {TEXT_MUTED} !important;",
        ".border-white\\/5, .border-white\\/7, .border-white\\/8, .border-white\\/10, .border-white\\/12, .border-white\\/15, .border-white\\/20, .border-white\\/\\[\\.06\\], .border-white\\/\\[\\.08\\]": f"border-color: {BORDER} !important;",
        ".divide-white\\/10 > :not([hidden]) ~ :not([hidden]), .divide-white\\/6 > :not([hidden]) ~ :not([hidden])": f"border-color: {BORDER} !important;",
        ".text-violet-100, .text-violet-200, .text-violet-300, .text-violet-400": f"color: {ACCENT_TEXT} !important;",
        ".border-violet-400\\/15, .border-violet-400\\/20, .border-violet-400\\/25, .border-violet-400\\/30, .border-violet-400\\/40, .border-violet-400\\/60, .hover\\:border-violet-400\\/40:hover, .focus\\:border-violet-400\\/60:focus": f"border-color: {ACCENT_BORDER} !important;",
        ".bg-violet-500\\/5, .bg-violet-500\\/10, .bg-violet-500\\/15, .bg-violet-500\\/20, .bg-violet-500\\/\\[\\.035\\], .bg-violet-500\\/\\[\\.045\\], .bg-violet-500\\/\\[\\.06\\], .bg-violet-500\\/\\[\\.07\\]": f"background-color: {ACCENT_TINT} !important;",
        ".bg-violet-400, .bg-violet-500, .border-violet-400": f"background: {GRADIENT_SOLID} !important; border-color: {ACCENT} !important;",
        ".bg-violet-400\\/70": f"background: {GRADIENT_BRAND} !important;",
        ".text-emerald-100, .text-emerald-200, .text-emerald-300, .text-green-100, .text-green-200": "color: #047857 !important;",
        ".text-amber-100, .text-amber-200, .text-amber-300, .text-orange-100, .text-orange-200": "color: #b45309 !important;",
        ".text-red-50, .text-red-100, .text-red-200, .text-red-300, .text-rose-100, .text-rose-200, .text-rose-300": "color: #b91c1c !important;",
        ".text-cyan-100, .text-cyan-200, .text-teal-100, .text-teal-200": "color: #0e7490 !important;",
        ".text-sky-100, .text-sky-200, .text-blue-100, .text-blue-200, .text-indigo-100, .text-indigo-200": "color: #0369a1 !important;",
        ".hover\\:bg-white\\/5:hover, .hover\\:bg-white\\/10:hover": f"background-color: {SURFACE_SOFT} !important;",
        ".flux-button, .flux-button:hover": f"background: {GRADIENT_SOLID} !important; color: #ffffff !important; box-shadow: 0 8px 20px rgba(15, 23, 42, .18) !important;",
        "button[class*=\"bg-primary\"], .bg-primary": f"background: {GRADIENT_SOLID} !important; color: #ffffff !important;",
        "button[class*=\"border-input\"], button[class*=\"bg-background\"]": f"background-color: #ffffff !important; color: {TEXT_DARK} !important; border-color: {BORDER_STRONG} !important;",
        ".brand-wordmark": f"color: {TEXT_DARK} !important;",
        ".eyebrow": f"color: {ACCENT_TEXT} !important;",
        "pre, code": f"color: {TEXT_DARK};",
        ".flux-sidebar": f"background: #ffffff !important; border-right: 1px solid {BORDER} !important;",
        ".flux-shell": f"background: {PAGE_WASH} !important; color: {TEXT_DARK} !important;",
        ".surface-panel": f"background: #ffffff !important; border-color: {BORDER} !important; box-shadow: 0 1px 2px rgba(15, 23, 42, .03), 0 12px 32px rgba(15, 23, 42, .04) !important;",
        "[data-sonner-toaster]": "color-scheme: light;",
    }
    for selector, decl in tw.items():
        scoped = ", ".join(f"html:not(.dark) {part.strip()}" for part in selector.split(", "))
        out.append(f"{scoped} {{ {decl} }}")
    manual = ROOT / "client/src/theme-light.manual.css"  # handgeschriebene Feinheiten, werden immer angehängt
    (ROOT / "client/src/theme-light.css").write_text("\n".join(out) + "\n" + (manual.read_text() if manual.exists() else ""))
    print("rules:", len(out))

if __name__ == "__main__":
    convert()
