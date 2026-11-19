import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallPlayer, type CallPlayerHandle, type PlayerMark } from "@/components/CallPlayer";

/**
 * Abspieler für Gespräche: mit einer echten Aufnahme steuert er das Audio-Element des Browsers; in der Vorschau (Adresse „vorschau:<Sekunden>“)
 * läuft nur eine Uhr. Die Testumgebung spielt nichts ab – play/pause/load sind hier nachgebaut und melden sich wie ein Browser.
 */
const MARKS: PlayerMark[] = [{ at: 21.5, label: "Ist der Kunde Eigentümer? – Ja", tone: "gruen" }, { at: 91, label: "Weitergabe erlaubt", tone: "rot" }, { at: 400, label: "liegt hinter dem Ende", tone: "gelb" }];
const set = (node: HTMLMediaElement, name: "paused" | "duration" | "readyState", value: unknown) => Object.defineProperty(node, name, { configurable: true, value });
const proto = window.HTMLMediaElement.prototype;
let play: ReturnType<typeof vi.spyOn>; let pause: ReturnType<typeof vi.spyOn>; let load: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  play = vi.spyOn(proto, "play").mockImplementation(function (this: HTMLMediaElement) { set(this, "paused", false); fireEvent(this, new Event("play")); return Promise.resolve(); });
  pause = vi.spyOn(proto, "pause").mockImplementation(function (this: HTMLMediaElement) { set(this, "paused", true); fireEvent(this, new Event("pause")); });
  load = vi.spyOn(proto, "load").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const parts = (root: HTMLElement) => {
  const ui = root.querySelector<HTMLElement>(".gq-player-ui")!; const [back, toggle, forward] = Array.from(ui.querySelectorAll<HTMLButtonElement>(".gq-player-row > button"));
  return { ui, back, toggle, forward, rate: ui.querySelector<HTMLButtonElement>(".gq-rate")!, range: ui.querySelector<HTMLInputElement>('.gq-scrub input[type="range"]')!, clock: () => ui.querySelector(".gq-clock")!.textContent, hint: () => ui.querySelector(".gq-scrub-hint")?.textContent ?? null, marks: () => Array.from(ui.querySelectorAll<HTMLButtonElement>(".gq-scrub-mark")), fill: () => parseFloat(ui.querySelector<HTMLElement>(".gq-scrub")!.style.getPropertyValue("--fill")) };
};
const click = async (node: Element) => { await act(async () => { fireEvent.click(node); }); };

describe("Abspieler – echte Aufnahme", () => {
  it("holt die Aufnahme erst beim Abspielen; Abspielen, Anhalten, Spulen, Tempo und Punkte steuern das Audio des Browsers", async () => {
    const onPlay = vi.fn(); const onTime = vi.fn(); const ref = createRef<CallPlayerHandle>();
    const view = render(<CallPlayer ref={ref} src="/api/aufnahmen/7" duration={200} marks={MARKS} hint="Die Punkte zeigen die Stellen." onPlay={onPlay} onTime={onTime} />);
    const p = parts(view.container); const audio = p.ui.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("/api/aufnahmen/7"); expect(audio.getAttribute("preload")).toBe("none"); expect(audio.hasAttribute("controls")).toBe(false); // nichts wird geholt, bevor jemand zuhört
    expect([p.back, p.toggle, p.forward].map((node) => node.getAttribute("aria-label"))).toEqual(["10 Sekunden zurück", "Abspielen", "10 Sekunden vor"]);
    expect(p.clock()).toBe("0:00 / 3:20"); // Dauer laut Dialer, bis die Aufnahme selbst sie meldet
    // Punkte: nur die innerhalb der Aufnahme; beim Anfassen stehen Zeit und Thema unter dem Balken
    expect(p.marks().map((node) => [node.className, node.style.left, node.getAttribute("aria-label")])).toEqual([["gq-scrub-mark is-gruen", "10.75%", "Zu 0:21 springen: Ist der Kunde Eigentümer? – Ja"], ["gq-scrub-mark is-rot", "45.5%", "Zu 1:31 springen: Weitergabe erlaubt"]]);
    expect(p.hint()).toBe("Die Punkte zeigen die Stellen.");
    await act(async () => { fireEvent.mouseEnter(p.marks()[1]); }); expect(p.hint()).toBe("1:31 Weitergabe erlaubt"); expect(p.ui.querySelector(".gq-scrub-hint")!.classList.contains("is-point")).toBe(true);
    await act(async () => { fireEvent.mouseLeave(p.marks()[1]); }); expect(p.hint()).toBe("Die Punkte zeigen die Stellen.");
    await act(async () => { fireEvent.focus(p.marks()[0]); }); expect(p.hint()).toBe("0:21 Ist der Kunde Eigentümer? – Ja"); await act(async () => { fireEvent.blur(p.marks()[0]); });

    // Abspielen: Die Aufnahme wird geholt (Ring am Knopf), dann läuft sie
    await click(p.toggle);
    expect(play).toHaveBeenCalledTimes(1); expect(onPlay).toHaveBeenCalledTimes(1);
    expect(p.toggle.classList.contains("is-loading")).toBe(true); expect(p.toggle.getAttribute("aria-busy")).toBe("true"); expect(p.toggle.getAttribute("aria-label")).toBe("Die Aufnahme wird geholt – anhalten"); expect(p.hint()).toBe("Die Aufnahme wird geholt – einen Moment …");
    set(audio, "duration", 187.4); set(audio, "readyState", 4);
    await act(async () => { fireEvent(audio, new Event("loadedmetadata")); fireEvent(audio, new Event("playing")); });
    expect(p.toggle.classList.contains("is-loading")).toBe(false); expect(p.toggle.classList.contains("is-playing")).toBe(true); expect(p.toggle.getAttribute("aria-label")).toBe("Anhalten");
    expect(p.clock()).toBe("0:00 / 3:07"); expect(p.marks()[1].style.left).toBe(`${(91 / 187.4) * 100}%`); // die Aufnahme meldet ihre echte Länge – die Punkte rücken nach
    // die Aufnahme läuft: Uhr und Balken folgen, die Seite erfährt die Stelle
    audio.currentTime = 33.2; await act(async () => { fireEvent(audio, new Event("timeupdate")); });
    expect(p.clock()).toBe("0:33 / 3:07"); expect(onTime).toHaveBeenLastCalledWith(33.2); expect(p.fill()).toBeCloseTo((33.2 / 187.4) * 100, 3); expect(p.range.value).toBe("33"); expect(p.range.getAttribute("aria-valuetext")).toBe("0:33 von 3:07");
    // 10 Sekunden vor und zurück – nie vor den Anfang, nie hinter das Ende
    await click(p.forward); expect(audio.currentTime).toBeCloseTo(43.2); expect(p.clock()).toBe("0:43 / 3:07");
    for (let i = 0; i < 6; i += 1) await click(p.back); expect(audio.currentTime).toBe(0); expect(p.clock()).toBe("0:00 / 3:07");
    await act(async () => { ref.current!.seek(180); }); await click(p.forward); expect(audio.currentTime).toBe(187.4); expect(p.clock()).toBe("3:07 / 3:07");
    // Balken ziehen, Tasten auf dem Balken
    await act(async () => { fireEvent.change(p.range, { target: { value: "120" } }); }); expect(audio.currentTime).toBe(120);
    const key = async (name: string) => { await act(async () => { fireEvent.keyDown(p.range, { key: name }); }); };
    await key("ArrowRight"); expect(audio.currentTime).toBe(125); await key("ArrowLeft"); await key("ArrowLeft"); expect(audio.currentTime).toBe(115); await key("Home"); expect(audio.currentTime).toBe(0); await key("End"); expect(audio.currentTime).toBe(187.4);
    // ein Punkt auf dem Balken und die Seite (Zeit an einer Prüffrage) springen an die Stelle und spielen ab
    const before = play.mock.calls.length;
    await click(p.marks()[1]); expect(audio.currentTime).toBe(91); expect(play.mock.calls.length).toBe(before + 1); expect(onTime).toHaveBeenLastCalledWith(91);
    await act(async () => { ref.current!.seek(21.5, true); }); expect(audio.currentTime).toBe(21.5); expect(play.mock.calls.length).toBe(before + 2); expect(p.clock()).toBe("0:21 / 3:07");
    expect(onPlay).toHaveBeenCalledTimes(3); // jedes Mal, wenn der Browser das Abspielen meldet – die Seite zählt selbst nur das erste Mal
    // Tempo
    expect(p.rate.textContent).toBe("1×"); await click(p.rate); expect(p.rate.textContent).toBe("1,25×"); expect(audio.playbackRate).toBe(1.25); expect(p.rate.getAttribute("aria-label")).toBe("Tempo: 1,25-fach – ändern");
    await click(p.rate); await click(p.rate); expect(p.rate.textContent).toBe("2×"); expect(audio.playbackRate).toBe(2); await click(p.rate); expect(p.rate.textContent).toBe("1×"); expect(audio.playbackRate).toBe(1);
    // anhalten – mit dem Knopf oder der Leertaste auf dem Balken
    await click(p.toggle); expect(pause).toHaveBeenCalledTimes(1); expect(p.toggle.getAttribute("aria-label")).toBe("Abspielen"); expect(p.toggle.classList.contains("is-playing")).toBe(false);
    await key(" "); expect(p.toggle.getAttribute("aria-label")).toBe("Anhalten"); await key(" "); expect(p.toggle.getAttribute("aria-label")).toBe("Abspielen"); expect(pause).toHaveBeenCalledTimes(2);
    // die Aufnahme stockt (Netz): der Ring läuft wieder, bis es weitergeht
    await click(p.toggle); await act(async () => { fireEvent(audio, new Event("waiting")); }); expect(p.toggle.classList.contains("is-loading")).toBe(true);
    await act(async () => { fireEvent(audio, new Event("canplay")); }); expect(p.toggle.classList.contains("is-loading")).toBe(false);
    await act(async () => { fireEvent(audio, new Event("ended")); }); expect(p.toggle.getAttribute("aria-label")).toBe("Abspielen");
  });

  it("lässt sich die Aufnahme nicht laden, steht das da – „Noch einmal versuchen“ holt sie neu, im gewählten Tempo", async () => {
    const view = render(<CallPlayer src="/api/aufnahmen/8" duration={null} marks={MARKS} hint="Hinweis" />); const p = parts(view.container); const audio = p.ui.querySelector("audio")!;
    expect(p.clock()).toBe("0:00 / –:––"); expect(p.range.disabled).toBe(true); expect(p.marks()).toHaveLength(0); expect(p.hint()).toBeNull(); // ohne bekannte Länge gibt es noch keinen Balken zum Ziehen und keine Punkte
    await click(p.rate); expect(audio.playbackRate).toBe(1.25);
    await click(p.toggle); expect(p.toggle.classList.contains("is-loading")).toBe(true);
    await act(async () => { fireEvent(audio, new Event("error")); });
    const alert = view.container.querySelector<HTMLElement>(".gq-player-error")!; expect(alert.getAttribute("role")).toBe("alert"); expect(alert.textContent).toBe("Die Aufnahme ließ sich nicht laden. Noch einmal versuchen");
    expect(p.ui.classList.contains("is-failed")).toBe(true); expect(p.toggle.classList.contains("is-loading")).toBe(false); expect(p.toggle.getAttribute("aria-label")).toBe("Abspielen");
    audio.playbackRate = 1; // nach einem neuen Laden setzt der Browser das Tempo zurück
    const calls = play.mock.calls.length; await click(alert.querySelector("button")!);
    expect(load).toHaveBeenCalledTimes(1); expect(play.mock.calls.length).toBe(calls + 1); expect(audio.playbackRate).toBe(1.25); expect(view.container.querySelector(".gq-player-error")).toBeNull();
    // eine andere Aufnahme: von vorn und im normalen Tempo
    view.rerender(<CallPlayer src="/api/aufnahmen/9" duration={90} marks={[]} />); const next = parts(view.container);
    expect(next.clock()).toBe("0:00 / 1:30"); expect(next.rate.textContent).toBe("1×"); expect(next.toggle.getAttribute("aria-label")).toBe("Abspielen"); expect(next.hint()).toBeNull();
  });
});

describe("Abspieler – Vorschau ohne Aufnahme", () => {
  it("lässt nur die Uhr laufen: abspielen, Tempo, anhalten, springen – am Ende bleibt sie stehen und beginnt beim nächsten Mal von vorn", async () => {
    vi.useFakeTimers(); const onPlay = vi.fn(); const onTime = vi.fn(); const ref = createRef<CallPlayerHandle>();
    const view = render(<CallPlayer ref={ref} src="vorschau:100" duration={999} marks={MARKS} hint="Hinweis" onPlay={onPlay} onTime={onTime} />); const p = parts(view.container);
    const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
    expect(p.ui.querySelector("audio")).toBeNull(); expect(p.clock()).toBe("0:00 / 1:40"); expect(p.marks()).toHaveLength(2); // die Länge steht in der Adresse
    await click(p.toggle); expect(onPlay).toHaveBeenCalledTimes(1); expect(play).not.toHaveBeenCalled(); expect(p.toggle.getAttribute("aria-label")).toBe("Anhalten"); expect(p.toggle.classList.contains("is-loading")).toBe(false);
    await tick(1000); expect(p.clock()).toBe("0:01 / 1:40"); expect(onTime).toHaveBeenLastCalledWith(1);
    await click(p.rate); await click(p.rate); await click(p.rate); expect(p.rate.textContent).toBe("2×"); await tick(2000); expect(p.clock()).toBe("0:05 / 1:40"); // doppeltes Tempo
    await click(p.toggle); expect(p.toggle.getAttribute("aria-label")).toBe("Abspielen"); await tick(3000); expect(p.clock()).toBe("0:05 / 1:40"); // angehalten
    await click(p.forward); expect(p.clock()).toBe("0:15 / 1:40"); await act(async () => { fireEvent.change(p.range, { target: { value: "50" } }); }); expect(p.clock()).toBe("0:50 / 1:40"); expect(p.fill()).toBe(50);
    await act(async () => { ref.current!.seek(98, true); }); expect(p.toggle.getAttribute("aria-label")).toBe("Anhalten"); expect(onPlay).toHaveBeenCalledTimes(2);
    await tick(1000); expect(p.clock()).toBe("1:40 / 1:40"); expect(p.toggle.getAttribute("aria-label")).toBe("Abspielen"); await tick(2000); expect(p.clock()).toBe("1:40 / 1:40"); // am Ende angekommen
    await click(p.toggle); await tick(500); expect(p.clock()).toBe("0:01 / 1:40"); // von vorn
    view.unmount(); expect(vi.getTimerCount()).toBe(0); // beim Verlassen der Seite läuft nichts weiter
  });
});

describe("Abspieler – kleine Leiste beim Scrollen", () => {
  it("zeigt sich erst, wenn die Aufnahme benutzt wurde und der Abspieler aus dem Blick ist; Schließen hält an", async () => {
    const seen: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []; const original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class { constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { seen.push(callback); } observe() {} unobserve() {} disconnect() {} };
    try {
      const view = render(<CallPlayer src="vorschau:300" marks={MARKS} />); const p = parts(view.container); expect(seen).toHaveLength(1);
      const dock = () => document.body.querySelector<HTMLElement>(".gq-player-dock"); const scroll = async (visible: boolean) => { await act(async () => { seen[0]([{ isIntersecting: visible }]); }); };
      await scroll(false); expect(dock()).toBeNull(); // noch nicht benutzt: keine Leiste
      await scroll(true); await click(p.toggle); expect(dock()).toBeNull(); // im Blick: keine Leiste
      await scroll(false);
      const bar = dock()!; expect(bar).toBeTruthy(); expect(bar.getAttribute("role")).toBe("group"); expect(bar.getAttribute("aria-label")).toBe("Aufnahme"); expect(view.container.contains(bar)).toBe(false); // hängt am Rand des Fensters, nicht in der Seite
      expect(Array.from(bar.querySelectorAll("button")).map((node) => node.getAttribute("aria-label"))).toEqual(["10 Sekunden zurück", "Anhalten", "10 Sekunden vor", "Leiste schließen und anhalten"]);
      expect(bar.querySelector('input[type="range"]')).toBeTruthy(); expect(bar.querySelectorAll(".gq-scrub-mark")).toHaveLength(0); expect(bar.querySelector(".gq-rate")).toBeNull(); // schlank: ohne Punkte und Tempo
      await click(bar.querySelectorAll("button")[2]); expect(p.clock()).toMatch(/^0:1\d \/ 5:00$/); expect(bar.querySelector(".gq-clock")!.textContent).toBe(p.clock()); // dieselbe Aufnahme, dieselbe Stelle
      await click(bar.querySelector(".gq-dock-close")!); expect(dock()).toBeNull(); expect(p.toggle.getAttribute("aria-label")).toBe("Abspielen");
      await click(p.toggle); expect(dock()).toBeTruthy(); // wieder abspielen: die Leiste ist wieder da
      await scroll(true); expect(dock()).toBeNull();
      await scroll(false); expect(dock()).toBeTruthy(); view.unmount(); expect(dock()).toBeNull();
    } finally { (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = original; }
  });
});
