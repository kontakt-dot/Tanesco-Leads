export type ClaimListQueryState = "loading" | "error" | "ready";

export function getClaimListQueryState(input: { isLoading: boolean; isError: boolean }): ClaimListQueryState {
  if (input.isLoading) return "loading";
  if (input.isError) return "error";
  return "ready";
}

export function retryClaimList(refetch: () => unknown) {
  return refetch();
}
