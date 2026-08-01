import type {
  GithubComNaibaBondsInternalDtoCreateImportantDateTypeRequest,
  GithubComNaibaBondsInternalDtoCreateMoodTrackingParameterRequest,
  GithubComNaibaBondsInternalDtoCreateTagRequest,
  GithubComNaibaBondsInternalDtoUpdateImportantDateTypeRequest,
  GithubComNaibaBondsInternalDtoUpdateMoodTrackingParameterRequest,
  GithubComNaibaBondsInternalDtoUpdateTagRequest,
} from "@/api";

type SimpleCrudFormValues = Readonly<Record<string, unknown>>;

export function buildCreateTagRequest(
  values: SimpleCrudFormValues,
): GithubComNaibaBondsInternalDtoCreateTagRequest {
  return { name: typeof values.name === "string" ? values.name : "" };
}

export function buildUpdateTagRequest(
  values: SimpleCrudFormValues,
): GithubComNaibaBondsInternalDtoUpdateTagRequest {
  return { name: typeof values.name === "string" ? values.name : "" };
}

export function buildCreateImportantDateTypeRequest(
  values: SimpleCrudFormValues,
): GithubComNaibaBondsInternalDtoCreateImportantDateTypeRequest {
  return { label: typeof values.label === "string" ? values.label : "" };
}

export function buildUpdateImportantDateTypeRequest(
  values: SimpleCrudFormValues,
): GithubComNaibaBondsInternalDtoUpdateImportantDateTypeRequest {
  return { label: typeof values.label === "string" ? values.label : "" };
}

export function buildCreateMoodTrackingParameterRequest(
  values: SimpleCrudFormValues,
): GithubComNaibaBondsInternalDtoCreateMoodTrackingParameterRequest {
  return {
    label: typeof values.label === "string" ? values.label : "",
    hex_color: typeof values.hex_color === "string" ? values.hex_color : "",
    ...(typeof values.position === "number"
      ? { position: values.position }
      : {}),
  };
}

export function buildUpdateMoodTrackingParameterRequest(
  values: SimpleCrudFormValues,
): GithubComNaibaBondsInternalDtoUpdateMoodTrackingParameterRequest {
  return {
    label: typeof values.label === "string" ? values.label : "",
    hex_color: typeof values.hex_color === "string" ? values.hex_color : "",
    ...(typeof values.position === "number"
      ? { position: values.position }
      : {}),
  };
}
