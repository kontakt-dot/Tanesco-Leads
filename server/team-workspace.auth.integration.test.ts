/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

const assignProduct = vi.fn();
const setMemberTeam = vi.fn();
const team = { id: 9, tenantId: 41, name: "PV Vertrieb", description: "Nordregion", color: "#8B5CF6" };
const product = { id: 17, tenantId: 41, name: "PV Premium", price: "60.00", status: "aktiv" };
vi.mock("../client/src/lib/trpc", () => ({ trpc: { useUtils: () => ({ leadops: new Proxy({}, { get: () => ({ invalidate: vi.fn() }) }) }), leadops: new Proxy({}, { get: (_target, key: string) => {
  if (key === "listTeams") return { useQuery: () => ({ data: [team], isLoading: false }) };
  if (key === "listProducts") return { useQuery: () => ({ data: [product], isLoading: false }) };
  if (key === "listMembers") return { useQuery: () => ({ data: [{ membershipId: 4, name: "Franz Weber", email: "franz@example.de", teamId: 9, role: "admin" }, { membershipId: 5, name: "Mira Schulz", email: "mira@example.de", teamId: 10, role: "vertrieb" }], isLoading: false }) };
  if (key === "getTeamDetail") return { useQuery: () => ({ data: { members: [{ membershipId: 4, name: "Franz Weber", email: "franz@example.de", role: "admin" }], products: [product] }, isLoading: false }) };
  if (key === "setTeamProductAssignment") return { useMutation: () => ({ mutate: assignProduct, isPending: false }) };
  if (key === "updateMembership") return { useMutation: () => ({ mutate: setMemberTeam, isPending: false }) };
  return { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
} }) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import TeamWorkspace from "../client/src/components/TeamWorkspace";

describe("Geschützter Teamarbeitsbereich", () => {
  beforeEach(() => { assignProduct.mockClear(); setMemberTeam.mockClear(); });
  it("zeigt Mandantenteam, Mitglied und Produktzuordnung und ermöglicht direkte Änderungen", async () => {
    render(createElement(TeamWorkspace));
    await waitFor(() => expect(screen.getAllByText("PV Vertrieb").length).toBeGreaterThan(0));
    expect(screen.getByText("Franz Weber")).toBeVisible();
    expect(screen.getByText("PV Premium")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Entfernen" })[0]);
    expect(setMemberTeam).toHaveBeenCalledWith({ id: 4, teamId: null });
    fireEvent.change(screen.getByLabelText("Mitglied zuordnen"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(setMemberTeam).toHaveBeenCalledWith({ id: 5, teamId: 9 });
    fireEvent.click(screen.getAllByRole("button", { name: "Entfernen" })[1]);
    expect(assignProduct).toHaveBeenCalledWith({ teamId: 9, productId: 17, assigned: false });
  });
});
