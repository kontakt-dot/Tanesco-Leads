/** Zuletzt gewähltes sipgate-Gerät des Agenten (nur in diesem Browser gemerkt – jeder Agent hat sein eigenes). */
const KEY = "tanesco-sipgate-device";
export function rememberedSipgateDevice(): string | null { try { return localStorage.getItem(KEY) || null; } catch { return null; } }
export function rememberSipgateDevice(deviceId: string | null) { try { if (deviceId) localStorage.setItem(KEY, deviceId); else localStorage.removeItem(KEY); } catch { /* privater Modus */ } }
/** Gerätetyp in Klartext: e = VoIP/App, x = externes Telefon, y = Mobilfunk (sipgate-SIM). */
export const sipgateDeviceKind = (id: string, type?: string | null) => type === "MOBILE" || id.startsWith("y") ? "sipgate-SIM" : type === "EXTERNAL" || id.startsWith("x") ? "externes Telefon" : "App / VoIP-Telefon";
