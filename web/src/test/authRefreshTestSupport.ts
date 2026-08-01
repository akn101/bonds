import { AxiosError } from "axios";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

export function createAxiosResponse<Data>(
  config: InternalAxiosRequestConfig,
  data: Data,
  status = 200,
): AxiosResponse<Data> {
  return {
    config,
    data,
    headers: {},
    status,
    statusText: status === 200 ? "OK" : "Unauthorized",
  };
}

export function createUnauthorizedAxiosError(
  config: InternalAxiosRequestConfig,
): AxiosError {
  return new AxiosError(
    "Request failed with status code 401",
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    createAxiosResponse(
      config,
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      401,
    ),
  );
}
