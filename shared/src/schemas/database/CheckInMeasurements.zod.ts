import { z } from "zod";

export const measurementSourceProvenanceEntrySchema = z.object({
  source: z.string(),
  source_id: z.string().nullable().optional(),
});

export const measurementSourceProvenanceSchema = z.record(
  z.string(),
  measurementSourceProvenanceEntrySchema,
);

export type MeasurementSourceProvenanceEntry = z.infer<
  typeof measurementSourceProvenanceEntrySchema
>;
export type MeasurementSourceProvenance = z.infer<
  typeof measurementSourceProvenanceSchema
>;

export const checkInMeasurementsSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  entry_date: z.coerce.date(),
  weight: z.number().nullable(),
  neck: z.number().nullable(),
  waist: z.number().nullable(),
  hips: z.number().nullable(),
  steps: z.number().nullable(),
  created_at: z.coerce.date().nullable().optional(),
  updated_at: z.coerce.date().nullable().optional(),
  height: z.number().nullable(),
  body_fat_percentage: z.number().nullable(),
  created_by_user_id: z.string().nullable(),
  updated_by_user_id: z.string().nullable(),
  muscle_mass_kg: z.number().nullable(),
  bone_mass_kg: z.number().nullable(),
  body_water_percentage: z.number().nullable(),
  source_provenance: measurementSourceProvenanceSchema,
});

export const checkInMeasurementsInitializerSchema = z.object({
  id: z.string().optional(),
  user_id: z.string(),
  entry_date: z.coerce.date().optional(),
  weight: z.number().optional().nullable(),
  neck: z.number().optional().nullable(),
  waist: z.number().optional().nullable(),
  hips: z.number().optional().nullable(),
  steps: z.number().optional().nullable(),
  created_at: z.coerce.date().nullable().optional(),
  updated_at: z.coerce.date().nullable().optional(),
  height: z.number().optional().nullable(),
  body_fat_percentage: z.number().optional().nullable(),
  created_by_user_id: z.string().optional().nullable(),
  updated_by_user_id: z.string().optional().nullable(),
  muscle_mass_kg: z.number().optional().nullable(),
  bone_mass_kg: z.number().optional().nullable(),
  body_water_percentage: z.number().optional().nullable(),
  source_provenance: measurementSourceProvenanceSchema.optional(),
});

export const checkInMeasurementsMutatorSchema =
  checkInMeasurementsInitializerSchema.partial();

export type DatabaseCheckInMeasurements = z.infer<
  typeof checkInMeasurementsSchema
>;
export type DatabaseCheckInMeasurementsInitializer = z.infer<
  typeof checkInMeasurementsInitializerSchema
>;
export type DatabaseCheckInMeasurementsMutator = z.infer<
  typeof checkInMeasurementsMutatorSchema
>;
