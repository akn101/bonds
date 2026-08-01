import type { LoginRequest, RegisterRequest, User } from "@/api";

export const ACCOUNT_A_TOKEN = "account-a-token";
export const ACCOUNT_A_FULL_TOKEN = "account-a-full-token";
export const ACCOUNT_A_TEMP_TOKEN = "account-a-temp-token";
export const ACCOUNT_B_TOKEN = "account-b-token";
export const VERIFY_CODE = "123456";
export const ACCOUNT_A_USER = { id: "account-a-user" } satisfies User;
export const ACCOUNT_B_USER = { id: "account-b-user" } satisfies User;
export const ACCOUNT_A_LOGIN = {
  email: "account-a@example.com",
  password: "account-a-password",
} satisfies LoginRequest;
export const ACCOUNT_B_LOGIN = {
  email: "account-b@example.com",
  password: "account-b-password",
} satisfies LoginRequest;
export const ACCOUNT_A_REGISTRATION = {
  first_name: "Account",
  last_name: "A",
  email: "register-a@example.com",
  password: "account-a-password",
} satisfies RegisterRequest;
