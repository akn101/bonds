import { expect, test } from "@playwright/test";
import { apiUrl } from "./api-base-url";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./admin-test-account";

type AuthResponse = {
  data?: {
    user?: {
      is_instance_administrator?: boolean;
    };
  };
};

test("bootstrap instance administrator", async ({ request }) => {
  const loginResponse = await request.post(apiUrl("/auth/login"), {
    data: {
      email: E2E_ADMIN_EMAIL,
      password: E2E_ADMIN_PASSWORD,
    },
  });

  if (loginResponse.ok()) {
    const loginBody = (await loginResponse.json()) as AuthResponse;
    expect(loginBody.data?.user?.is_instance_administrator).toBe(true);
    return;
  }

  const registerResponse = await request.post(apiUrl("/auth/register"), {
    data: {
      first_name: "E2E",
      last_name: "Administrator",
      email: E2E_ADMIN_EMAIL,
      password: E2E_ADMIN_PASSWORD,
    },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const registerBody = (await registerResponse.json()) as AuthResponse;
  expect(registerBody.data?.user?.is_instance_administrator).toBe(true);
});
