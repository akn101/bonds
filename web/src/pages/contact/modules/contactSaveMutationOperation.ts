// TanStack can replace pending observer options, so onSuccess must use operation identity from variables, not current editing state.
export type ContactSaveMutationOperation<TFormValues> =
  | { readonly kind: "create"; readonly values: TFormValues }
  | {
      readonly kind: "update";
      readonly id: number;
      readonly values: TFormValues;
    };

export function createContactSaveMutationOperation<TFormValues>(
  editingId: number | null,
  values: TFormValues,
): ContactSaveMutationOperation<TFormValues> {
  return editingId === null
    ? { kind: "create", values }
    : { kind: "update", id: editingId, values };
}
