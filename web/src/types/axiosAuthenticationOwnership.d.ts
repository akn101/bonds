import type { AuthenticationRequestOwnership } from "@/api/authenticationRequestOwnership";

declare module "axios" {
  interface AxiosRequestConfig {
    authenticationOwnership?: AuthenticationRequestOwnership;
    _retry?: boolean;
  }
}
