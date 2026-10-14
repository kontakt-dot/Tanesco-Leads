export function selectOrderByDeepLink<T extends { id: number; orderNumber: string }>(orders: readonly T[] | undefined, orderNumber: string | null, selectedId: number | null) {
  return orders?.find((order) => order.orderNumber === orderNumber || order.id === selectedId) ?? null;
}

export function selectMembershipByDeepLink<T extends { membershipId: number }>(members: readonly T[] | undefined, membershipId: number | null, selectedId: number | null) {
  return members?.find((member) => member.membershipId === (membershipId ?? selectedId)) ?? null;
}
