export type SearchTarget = { page: "Leads" | "Bestellungen" | "Benutzer" | "Vertriebspipeline"; param: "leadId" | "orderId" | "memberId" | "lead"; value: string | number; extra?: Record<string, string> };

export function searchTargetUrl(target: SearchTarget) {
  const params = new URLSearchParams({ page: target.page, ...(target.extra ?? {}), [target.param]: String(target.value) });
  return `/?${params.toString()}`;
}
