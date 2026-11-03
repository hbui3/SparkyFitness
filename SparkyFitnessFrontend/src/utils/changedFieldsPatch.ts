type EditableScalar = string | number | boolean | null;

/** Send only deliberate edits so a background refresh cannot undo other work. */
export function changedFieldsPatch<T extends Record<string, EditableScalar>>(
  original: T,
  edited: T
): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(edited) as Array<keyof T>) {
    if (edited[key] !== original[key]) patch[key] = edited[key];
  }
  return patch;
}
