"""Tauscht den lila Akzent gegen das Tanesco-Rot – in den Stylesheets (Farbton-Drehung, Helligkeit bleibt) und den Komponenten (Tailwind-Klassen)."""
import colorsys, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CSS_FILES = [ROOT / "client/src/index.css", ROOT / "client/src/lead-refinements.css", ROOT / "client/src/automation-refinements.css"]
TSX_DIRS = [ROOT / "client/src/components", ROOT / "client/src/demo", ROOT / "client/src/pages", ROOT / "client/src/lib"]
BRAND_HUE = 2 / 360  # Tanesco-Rot (#c81e19)

def rotate(token: str) -> str:
    """Violette Farben (Farbton 230–300°, gesättigt) → Rot mit gleicher Helligkeit/Deckkraft."""
    m = re.fullmatch(r"#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?", token)
    if m:
        h6 = m.group(1); r, g, b = (int(h6[i:i + 2], 16) / 255 for i in (0, 2, 4))
        hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
        if 0.62 <= hh <= 0.83 and ss > 0.25:
            nr, ng, nb = colorsys.hls_to_rgb(BRAND_HUE, ll, min(ss, 0.9))
            return "#%02x%02x%02x%s" % (round(nr * 255), round(ng * 255), round(nb * 255), m.group(2) or "")
        return token
    m = re.fullmatch(r"(rgba?)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(,\s*[\d.]+\s*)?\)", token)
    if m:
        r, g, b = (float(m.group(i)) / 255 for i in (2, 3, 4))
        hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
        if 0.62 <= hh <= 0.83 and ss > 0.25:
            nr, ng, nb = colorsys.hls_to_rgb(BRAND_HUE, ll, min(ss, 0.9))
            return f"{m.group(1)}({round(nr * 255)},{round(ng * 255)},{round(nb * 255)}{m.group(5) or ''})"
        return token
    return token

def recolor_css(text: str) -> str:
    text = re.sub(r"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|rgba?\([^)]*\)", lambda m: rotate(m.group(0)), text)
    # shadcn-Token (oklch) für Primärfarbe und Fokusring
    text = text.replace("--primary: oklch(0.72 0.17 283)", "--primary: oklch(0.56 0.21 27)").replace("--ring: oklch(0.72 0.17 283)", "--ring: oklch(0.62 0.21 27)")
    return text

TAILWIND_MAP = [("violet-", "red-"), ("purple-", "red-"), ("indigo-", "red-"), ("fuchsia-", "red-")]

def recolor_tsx(text: str) -> str:
    for src, dst in TAILWIND_MAP:
        text = text.replace(src, dst)
    text = re.sub(r"#[0-9a-fA-F]{6}\b", lambda m: rotate(m.group(0)), text)
    return text

if __name__ == "__main__":
    changed = 0
    for path in CSS_FILES:
        if not path.exists(): continue
        before = path.read_text(); after = recolor_css(before)
        if after != before: path.write_text(after); changed += 1
    for folder in TSX_DIRS:
        if not folder.exists(): continue
        for path in folder.rglob("*.ts*"):
            if "__tests__" in str(path) or path.name.endswith(".test.tsx") or path.name.endswith(".test.ts"): continue
            before = path.read_text(); after = recolor_tsx(before)
            if after != before: path.write_text(after); changed += 1
    print("files changed:", changed)
