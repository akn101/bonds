import { describe, expect, it } from "vitest";
import type {
  GithubComNaibaBondsInternalDtoCreateImportantDateTypeRequest,
  GithubComNaibaBondsInternalDtoCreateMoodTrackingParameterRequest,
  GithubComNaibaBondsInternalDtoCreateTagRequest,
  GithubComNaibaBondsInternalDtoUpdateImportantDateTypeRequest,
  GithubComNaibaBondsInternalDtoUpdateMoodTrackingParameterRequest,
  GithubComNaibaBondsInternalDtoUpdateTagRequest,
} from "@/api";
import {
  buildCreateImportantDateTypeRequest,
  buildCreateMoodTrackingParameterRequest,
  buildCreateTagRequest,
  buildUpdateImportantDateTypeRequest,
  buildUpdateMoodTrackingParameterRequest,
  buildUpdateTagRequest,
} from "@/utils/vaultSettingsRequests";

type FormValues = Readonly<Record<string, unknown>>;

type BuilderCase<Request> = {
  readonly name: string;
  readonly values: FormValues;
  readonly expected: Request;
};

const tagCreateCases = [
  {
    name: "keeps a valid name",
    values: { name: "Travel" },
    expected: { name: "Travel" },
  },
  {
    name: "keeps an explicitly empty name",
    values: { name: "" },
    expected: { name: "" },
  },
  {
    name: "uses an empty name when name is missing",
    values: {},
    expected: { name: "" },
  },
  {
    name: "uses an empty name when name has the wrong type",
    values: { name: 42 },
    expected: { name: "" },
  },
] satisfies readonly BuilderCase<GithubComNaibaBondsInternalDtoCreateTagRequest>[];

const tagUpdateCases = [
  {
    name: "keeps a valid name",
    values: { name: "Family" },
    expected: { name: "Family" },
  },
  {
    name: "keeps an explicitly empty name",
    values: { name: "" },
    expected: { name: "" },
  },
  {
    name: "uses an empty name when name is missing",
    values: {},
    expected: { name: "" },
  },
  {
    name: "uses an empty name when name has the wrong type",
    values: { name: false },
    expected: { name: "" },
  },
] satisfies readonly BuilderCase<GithubComNaibaBondsInternalDtoUpdateTagRequest>[];

const importantDateTypeCreateCases = [
  {
    name: "keeps a valid label",
    values: { label: "Graduation" },
    expected: { label: "Graduation" },
  },
  {
    name: "keeps an explicitly empty label",
    values: { label: "" },
    expected: { label: "" },
  },
  {
    name: "uses an empty label when label is missing",
    values: {},
    expected: { label: "" },
  },
  {
    name: "uses an empty label when label has the wrong type",
    values: { label: 42 },
    expected: { label: "" },
  },
] satisfies readonly BuilderCase<GithubComNaibaBondsInternalDtoCreateImportantDateTypeRequest>[];

const importantDateTypeUpdateCases = [
  {
    name: "keeps a valid label",
    values: { label: "Wedding anniversary" },
    expected: { label: "Wedding anniversary" },
  },
  {
    name: "keeps an explicitly empty label",
    values: { label: "" },
    expected: { label: "" },
  },
  {
    name: "uses an empty label when label is missing",
    values: {},
    expected: { label: "" },
  },
  {
    name: "uses an empty label when label has the wrong type",
    values: { label: false },
    expected: { label: "" },
  },
] satisfies readonly BuilderCase<GithubComNaibaBondsInternalDtoUpdateImportantDateTypeRequest>[];

const moodCreateCases = [
  {
    name: "keeps label, color, and a positive position",
    values: { label: "Focused", hex_color: "#1677ff", position: 2 },
    expected: { label: "Focused", hex_color: "#1677ff", position: 2 },
  },
  {
    name: "keeps position zero",
    values: { label: "Neutral", hex_color: "#808080", position: 0 },
    expected: { label: "Neutral", hex_color: "#808080", position: 0 },
  },
  {
    name: "omits position when it is missing",
    values: { label: "Calm", hex_color: "#22c55e" },
    expected: { label: "Calm", hex_color: "#22c55e" },
  },
  {
    name: "uses empty strings for missing label and color",
    values: {},
    expected: { label: "", hex_color: "" },
  },
  {
    name: "uses empty strings for wrong-typed label and color",
    values: { label: 42, hex_color: false, position: "first" },
    expected: { label: "", hex_color: "" },
  },
  {
    name: "keeps an empty color string but ignores unrelated defaults",
    values: {
      label: "Unset",
      hex_color: "",
      is_default: true,
      required: false,
    },
    expected: { label: "Unset", hex_color: "" },
  },
] satisfies readonly BuilderCase<GithubComNaibaBondsInternalDtoCreateMoodTrackingParameterRequest>[];

const moodUpdateCases = [
  {
    name: "keeps label, color, and a positive position",
    values: { label: "Relaxed", hex_color: "#22c55e", position: 3 },
    expected: { label: "Relaxed", hex_color: "#22c55e", position: 3 },
  },
  {
    name: "keeps position zero",
    values: { label: "Low", hex_color: "#ef4444", position: 0 },
    expected: { label: "Low", hex_color: "#ef4444", position: 0 },
  },
  {
    name: "omits position when it is missing",
    values: { label: "Steady", hex_color: "#f59e0b" },
    expected: { label: "Steady", hex_color: "#f59e0b" },
  },
  {
    name: "uses empty strings for missing label and color",
    values: {},
    expected: { label: "", hex_color: "" },
  },
  {
    name: "uses empty strings for wrong-typed label and color",
    values: { label: null, hex_color: 123, position: null },
    expected: { label: "", hex_color: "" },
  },
  {
    name: "keeps an empty color string but ignores unrelated defaults",
    values: {
      label: "Unknown",
      hex_color: "",
      is_default: false,
      default_value: "",
    },
    expected: { label: "Unknown", hex_color: "" },
  },
] satisfies readonly BuilderCase<GithubComNaibaBondsInternalDtoUpdateMoodTrackingParameterRequest>[];

describe("vault settings request builders", () => {
  it.each(tagCreateCases)("creates tags: $name", ({ values, expected }) => {
    // Given: form values from the tag create form.
    // When: the create request builder is called.
    // Then: the exact generated DTO payload is returned.
    expect(buildCreateTagRequest(values)).toEqual(expected);
  });

  it.each(tagUpdateCases)("updates tags: $name", ({ values, expected }) => {
    // Given: form values from the tag update form.
    // When: the update request builder is called.
    // Then: the exact generated DTO payload is returned.
    expect(buildUpdateTagRequest(values)).toEqual(expected);
  });

  it.each(importantDateTypeCreateCases)(
    "creates important date types: $name",
    ({ values, expected }) => {
      // Given: form values from the important date type create form.
      // When: the create request builder is called.
      // Then: the exact generated DTO payload is returned.
      expect(buildCreateImportantDateTypeRequest(values)).toEqual(expected);
    },
  );

  it.each(importantDateTypeUpdateCases)(
    "updates important date types: $name",
    ({ values, expected }) => {
      // Given: form values from the important date type update form.
      // When: the update request builder is called.
      // Then: the exact generated DTO payload is returned.
      expect(buildUpdateImportantDateTypeRequest(values)).toEqual(expected);
    },
  );

  it.each(moodCreateCases)(
    "creates mood parameters: $name",
    ({ values, expected }) => {
      // Given: form values from the mood parameter create form.
      // When: the create request builder is called.
      // Then: the exact generated DTO payload is returned.
      expect(buildCreateMoodTrackingParameterRequest(values)).toEqual(expected);
    },
  );

  it.each(moodUpdateCases)(
    "updates mood parameters: $name",
    ({ values, expected }) => {
      // Given: form values from the mood parameter update form.
      // When: the update request builder is called.
      // Then: the exact generated DTO payload is returned.
      expect(buildUpdateMoodTrackingParameterRequest(values)).toEqual(expected);
    },
  );
});
