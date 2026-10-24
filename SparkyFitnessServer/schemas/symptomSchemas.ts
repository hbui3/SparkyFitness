import {
  addSymptomSeverityBodySchema,
  createSymptomDefinitionBodySchema,
  createSymptomEntryBodySchema,
  createSymptomOptionBodySchema,
  endSymptomEpisodeBodySchema,
  listSymptomEntriesQuerySchema,
  listSymptomFreeDaysQuerySchema,
  listSymptomOptionsQuerySchema,
  markSymptomFreeBodySchema,
  symptomContextQuerySchema,
  updateSymptomDefinitionBodySchema,
  updateSymptomEntryBodySchema,
  updateSymptomOptionBodySchema,
} from '@workspace/shared';
import type {
  AddSymptomSeverityBody,
  CreateSymptomDefinitionBody,
  CreateSymptomEntryBody,
  CreateSymptomOptionBody,
  EndSymptomEpisodeBody,
  ListSymptomEntriesQuery,
  SymptomTreatmentInput,
  UpdateSymptomDefinitionBody,
  UpdateSymptomEntryBody,
  UpdateSymptomOptionBody,
} from '@workspace/shared';

// The symptom API contract lives in @workspace/shared so web, mobile and the
// server validate the same shapes; re-export it under the server's naming.
export const CreateCustomSymptomBodySchema = createSymptomDefinitionBodySchema;
export const UpdateCustomSymptomBodySchema = updateSymptomDefinitionBodySchema;
export const CreateSymptomOptionBodySchema = createSymptomOptionBodySchema;
export const UpdateSymptomOptionBodySchema = updateSymptomOptionBodySchema;
export const ListSymptomOptionsQuerySchema = listSymptomOptionsQuerySchema;
export const CreateSymptomEntryBodySchema = createSymptomEntryBodySchema;
export const UpdateSymptomEntryBodySchema = updateSymptomEntryBodySchema;
export const EndSymptomEpisodeBodySchema = endSymptomEpisodeBodySchema;
export const AddSymptomSeverityBodySchema = addSymptomSeverityBodySchema;
export const ListSymptomEntriesQuerySchema = listSymptomEntriesQuerySchema;
export const MarkSymptomFreeBodySchema = markSymptomFreeBodySchema;
export const SymptomContextQuerySchema = symptomContextQuerySchema;
export const ListSymptomFreeDaysQuerySchema = listSymptomFreeDaysQuerySchema;

export type CreateCustomSymptomBody = CreateSymptomDefinitionBody;
export type UpdateCustomSymptomBody = UpdateSymptomDefinitionBody;
export type {
  AddSymptomSeverityBody,
  CreateSymptomEntryBody,
  CreateSymptomOptionBody,
  EndSymptomEpisodeBody,
  ListSymptomEntriesQuery,
  SymptomTreatmentInput,
  UpdateSymptomEntryBody,
  UpdateSymptomOptionBody,
};
