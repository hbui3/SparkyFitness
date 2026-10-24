/** The mean of `values`, or `null` for an empty list rather than `NaN`. */
export const average = (values: number[]): number | null => {
  if (values.length === 0) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
