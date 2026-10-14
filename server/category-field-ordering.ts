export type SortableCategoryField = { id: number };

export function reorderCategoryFields<T extends SortableCategoryField>(fields: readonly T[], fieldId: number, direction: "up" | "down") {
  const index = fields.findIndex((field) => field.id === fieldId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= fields.length) return { moved: false, fields: [...fields] };
  const reordered = [...fields]; const [moved] = reordered.splice(index, 1); reordered.splice(targetIndex, 0, moved);
  return { moved: true, fields: reordered };
}
