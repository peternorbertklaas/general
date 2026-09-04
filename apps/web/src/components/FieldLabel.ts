import { createContext, useContext } from "react";

/**
 * Label of the enclosing form `Field` – inputs and selects without an explicit
 * `ariaLabel` take it as their accessible name (R3-03). `undefined` outside a field.
 */
export const FieldLabelContext = createContext<string | undefined>(undefined);

export function useFieldLabel(explicit?: string): string | undefined {
  const ctx = useContext(FieldLabelContext);
  return explicit ?? ctx;
}
