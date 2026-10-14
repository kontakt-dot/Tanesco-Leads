/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import PVWorkspaceControls from "../client/src/components/PVWorkspaceControls";
import { buildProtectedCategoryWorkspaceContract } from "../client/src/components/lead-category-contract";

describe("Gerenderter PV-Arbeitsbereich", () => {
  it("zeigt im geschützten Arbeitsvertrag alle Tabs und Betriebswerkzeuge und leitet die Aktionen weiter", () => {
    const onTabChange = vi.fn(); const onCsv = vi.fn(); const onParameters = vi.fn();
    render(createElement(PVWorkspaceControls, { contract: buildProtectedCategoryWorkspaceContract({ tenantId: 41, categoryId: 55 }), activeTab: "settings", fieldCount: 26, mappingCount: 1, onTabChange, onCsv, onParameters }));
    expect(screen.getByRole("button", { name: "Grundeinstellungen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Benutzerdefinierte Felder (26)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Datenharmonisierung (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Benutzerdefinierte Felder (26)" }));
    fireEvent.click(screen.getByRole("button", { name: "CSV-Vorlage" }));
    fireEvent.click(screen.getByRole("button", { name: "Parameterblatt" }));
    expect(onTabChange).toHaveBeenCalledWith("fields"); expect(onCsv).toHaveBeenCalledOnce(); expect(onParameters).toHaveBeenCalledOnce();
  });
});
