export function globalSearchFeedback(input: string, state: { isLoading: boolean; isError: boolean; hasResults: boolean }) {
  if (state.isLoading) return "Suche in Ihrer Lead-Organisation …";
  if (state.isError) return "Die Suche konnte nicht geladen werden. Bitte versuchen Sie es erneut.";
  if (!state.hasResults) return `Keine Ergebnisse für „${input}“.`;
  return null;
}

export function shouldShowGlobalSearchRetry(input: string, isError: boolean) {
  return input.length >= 2 && isError;
}

export function retryGlobalSearch(refetch: () => unknown) {
  return refetch();
}
