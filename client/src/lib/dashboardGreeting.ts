export function dashboardGreeting(hour: number): "Guten Morgen" | "Guten Tag" | "Guten Abend" {
  if (hour < 12) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}
