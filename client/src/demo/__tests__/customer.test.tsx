import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoApp from "../App.demo";
import { callProcedure, getStore, resetStore } from "../backend";
import { localDemoLink } from "../link";

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = trpc.createClient({ links: [localDemoLink()] });
  const view = render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><DemoApp /></QueryClientProvider></trpc.Provider>);
  return { view, queryClient };
}
async function settle(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); }
const call = (path: string, input?: unknown) => callProcedure(path, input) as Promise<any>;

describe("Als Benutzer einloggen → Kunden-Layout „MEIN BEREICH“", () => {
  beforeEach(() => { resetStore(); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("zeigt Kundenbereich, gelbes Banner, gefilterte Seitenleiste und kehrt zur Benutzerseite zurück", async () => {
    const buyer = getStore().tables.memberships.find((row) => row.partnerType === "käufer" && row.status === "aktiv")!;
    const owner = getStore().tables.memberships.find((row) => row.role === "inhaber")!;
    await expect(call("auth.impersonate", { membershipId: owner.id })).rejects.toThrow("Inhaber");
    // Ansicht des Kunden: nur Bestellungen + Support sichtbar
    await call("leadops.updateMemberVisibility", { membershipId: buyer.id, visibleAreas: ["Bestellungen", "Support"], visibleCategoryIds: null });
    const started = await call("auth.impersonate", { membershipId: buyer.id });
    expect(started.membershipId).toBe(buyer.id);
    expect(getStore().tables.impersonationSessions.filter((row) => row.targetUserId === buyer.userId && !row.endedAt)).toHaveLength(1);
    const access = await call("leadops.customerAccess");
    expect(access.partnerType).toBe("käufer");
    expect(access.pages).toEqual(["Dashboard", "Leads", "Bestellungen", "Support", "Einstellungen"]);
    const dashboard = await call("leadops.customerDashboard");
    expect(dashboard.kpis.leadsTotal).toBeGreaterThan(0);
    expect((await call("leadops.customerLeads", {})).length).toBe(dashboard.kpis.leadsTotal);
    window.history.replaceState(null, "", "/?page=Dashboard");
    const { view } = mount();
    await settle(300); await settle(300); await settle(300);
    const html = view.container.innerHTML;
    expect(html).toContain("MEIN BEREICH");
    expect(html).toContain("Du siehst die Plattform als");
    expect(html).toContain("Zurück zum Admin");
    expect(html).not.toContain("Rohdaten"); expect(html).not.toContain(">Reklamationen<"); expect(html).not.toContain("Suchen: Benutzer");
    expect(html).toContain(">Bestellungen<"); expect(html).toContain(">Support<");
    // Zurück zum Admin → Sitzung beendet, Rücksprung-ID für die Benutzer-Detailseite
    const button = Array.from(view.container.querySelectorAll("button")).find((item) => item.textContent?.includes("Zurück zum Admin"))!;
    await act(async () => { fireEvent.click(button); }); await settle(400);
    expect(getStore().tables.impersonationSessions.every((row) => row.endedAt)).toBe(true);
    expect((await call("leadops.customerAccess")).partnerType).toBe("intern"); // wieder der Admin
    await call("auth.impersonate", { membershipId: buyer.id });
    expect((await call("auth.stopImpersonation")).membershipId).toBe(buyer.id);
    const activity = await call("leadops.listMemberActivity", { membershipId: buyer.id });
    expect(activity.some((event: { title: string }) => event.title.startsWith("Als Benutzer eingeloggt durch Admin"))).toBe(true);
    expect(activity.some((event: { title: string }) => event.title.startsWith("Admin-Sitzung beendet"))).toBe(true);
  });
});
