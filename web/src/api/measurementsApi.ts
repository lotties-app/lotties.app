import {
  apiPaths,
  type MeasurementDto,
  type MeasurementRequest,
  type NapperImportRequest,
  type NapperImportResultDto,
  type NapperPreviewDto,
} from '../sync/contract';
import type { ApiClient } from './apiClient';

/* Online-only growth measurement and Napper import calls (no offline queue). */

export async function listMeasurements(api: ApiClient, babyId: string): Promise<MeasurementDto[]> {
  return (await api.request<MeasurementDto[]>(apiPaths.measurements(babyId))) ?? [];
}

/** Idempotent upsert with a client GUID: replaying the same call is safe. */
export async function putMeasurement(
  api: ApiClient,
  babyId: string,
  id: string,
  request: MeasurementRequest,
): Promise<void> {
  await api.request<unknown>(apiPaths.measurement(babyId, id), { method: 'PUT', body: request });
}

export async function deleteMeasurement(api: ApiClient, babyId: string, id: string): Promise<void> {
  await api.request<unknown>(apiPaths.measurement(babyId, id), { method: 'DELETE' });
}

export function previewNapperImport(
  api: ApiClient,
  babyId: string,
  request: NapperImportRequest,
): Promise<NapperPreviewDto> {
  return api.request<NapperPreviewDto>(apiPaths.importNapperPreview(babyId), {
    method: 'POST',
    body: request,
  });
}

export function runNapperImport(
  api: ApiClient,
  babyId: string,
  request: NapperImportRequest,
): Promise<NapperImportResultDto> {
  return api.request<NapperImportResultDto>(apiPaths.importNapper(babyId), {
    method: 'POST',
    body: request,
  });
}
