export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    referenceId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
