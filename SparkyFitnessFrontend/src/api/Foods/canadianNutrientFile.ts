import { apiCall } from '../api';
import type {
  CnfBulkImportStatus,
  CnfDeleteLibraryResponse,
} from '@workspace/shared';

export interface TriggerCnfBulkImportParams {
  file?: File;
  archiveUrl?: string;
  syncPastEntries?: boolean;
  language?: 'en' | 'fr';
  maxFoods?: number;
  wait?: boolean;
}

export async function fetchCnfStatus(): Promise<CnfBulkImportStatus> {
  return apiCall<CnfBulkImportStatus>('/foods/canadian-nutrient-file/status', {
    method: 'GET',
  });
}

export async function triggerCnfBulkImport(
  params: TriggerCnfBulkImportParams
): Promise<{
  message: string;
  imported?: number;
  updated?: number;
  total?: number;
  status?: CnfBulkImportStatus;
}> {
  const query = params.wait ? '?wait=true' : '';
  const url = `/foods/canadian-nutrient-file/bulk-import${query}`;

  if (params.file) {
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.syncPastEntries !== undefined) {
      formData.append('syncPastEntries', String(params.syncPastEntries));
    }
    if (params.language) {
      formData.append('language', params.language);
    }
    if (params.maxFoods !== undefined) {
      formData.append('maxFoods', String(params.maxFoods));
    }
    return apiCall(url, {
      method: 'POST',
      body: formData,
      isFormData: true,
    });
  }

  return apiCall(url, {
    method: 'POST',
    body: {
      archiveUrl: params.archiveUrl,
      syncPastEntries: params.syncPastEntries ?? false,
      language: params.language ?? 'en',
      maxFoods: params.maxFoods,
    },
  });
}

export async function deleteCnfLibrary(): Promise<CnfDeleteLibraryResponse> {
  return apiCall<CnfDeleteLibraryResponse>('/foods/canadian-nutrient-file', {
    method: 'DELETE',
  });
}
