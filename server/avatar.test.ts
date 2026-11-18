import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, avatarUrlOf, initialsOf, parseAvatarDataUrl, sniffImage } from "../shared/avatar";

const b64 = (bytes: number[], fill = 300) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(fill, 7)]).toString("base64");
const JPEG = [0xff, 0xd8, 0xff, 0xe0]; const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]; const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

describe("Profilbilder – Prüfung des hochgeladenen Bildes", () => {
  it("erkennt JPEG, PNG und WebP am Dateianfang", () => {
    expect(sniffImage(b64(JPEG))).toBe("image/jpeg"); expect(sniffImage(b64(PNG))).toBe("image/png"); expect(sniffImage(b64(WEBP))).toBe("image/webp");
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").toString("base64"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a................").toString("base64"))).toBeNull(); expect(sniffImage("")).toBeNull(); expect(sniffImage("%%%")).toBeNull();
  });
  it("nimmt ein kleines Bild an und liefert Art, Daten und Größe", () => {
    const image = parseAvatarDataUrl(`data:image/jpeg;base64,${b64(JPEG)}`);
    expect(image.mime).toBe("image/jpeg"); expect(image.bytes).toBe(304); expect(Buffer.from(image.base64, "base64").length).toBe(304);
    expect(parseAvatarDataUrl(`  data:image/png;base64,${b64(PNG)}  `).mime).toBe("image/png");
  });
  it("vertraut nicht der behaupteten Art: entscheidend ist der Inhalt", () => {
    expect(parseAvatarDataUrl(`data:image/png;base64,${b64(JPEG)}`).mime).toBe("image/jpeg"); // als PNG ausgegeben, ist aber JPEG
    expect(() => parseAvatarDataUrl(`data:image/jpeg;base64,${Buffer.from("<svg><script>alert(1)</script></svg>" + "x".repeat(200)).toString("base64")}`)).toThrow(/Bildformat geht nicht/);
    expect(() => parseAvatarDataUrl(`data:image/svg+xml;base64,${Buffer.from("<svg></svg>" + " ".repeat(200)).toString("base64")}`)).toThrow(/Bildformat geht nicht/);
  });
  it("lehnt Unsinn, Leeres und zu Großes mit einer verständlichen Meldung ab", () => {
    for (const bad of [null, undefined, 5, "", "hallo", "data:text/html;base64,PGh0bWw+", "data:image/jpeg;base64,", "data:image/jpeg,keinbase64", "https://example.com/bild.jpg", `data:image/jpeg;base64,${b64(JPEG)}"><script>`]) expect(() => parseAvatarDataUrl(bad)).toThrow(/kein Bild/);
    expect(() => parseAvatarDataUrl(`data:image/jpeg;base64,${b64(JPEG, 10)}`)).toThrow(/leer/);
    expect(() => parseAvatarDataUrl(`data:image/jpeg;base64,${b64(JPEG, AVATAR_MAX_BYTES + 10)}`)).toThrow(/zu groß \(höchstens 400 KB\)/);
    expect(parseAvatarDataUrl(`data:image/jpeg;base64,${b64(JPEG, AVATAR_MAX_BYTES - 4)}`).bytes).toBe(AVATAR_MAX_BYTES); // genau an der Grenze geht
  });
  it("Adresse und Initialen", () => {
    expect(avatarUrlOf("abc123")).toBe("/api/avatar/abc123"); expect(avatarUrlOf(null)).toBeNull(); expect(avatarUrlOf(undefined)).toBeNull(); expect(avatarUrlOf("")).toBeNull();
    expect(initialsOf("Tanesco Admin")).toBe("TA"); expect(initialsOf("Anna Maria Schmidt")).toBe("AS"); expect(initialsOf("taner")).toBe("TA"); expect(initialsOf("")).toBe("?"); expect(initialsOf(null, "TL")).toBe("TL"); expect(initialsOf("max.muster@firma.de")).toBe("MM"); expect(initialsOf("info@firma.de")).toBe("IN");
  });
});
