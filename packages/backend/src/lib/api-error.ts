import { ApiErrorSchema } from '@crucible/types';

type ApiErrorCode =
  | 'conflict'
  | 'internal'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'unauthorized'
  | 'rate_limited'
  | 'mesh_unavailable'
  | 'runtime_unavailable'
  | 'inference_unavailable'
  | 'keeperhub_unavailable';

export function createApiErrorBody(code: ApiErrorCode, message: string) {
  return ApiErrorSchema.parse({ code, message });
}
