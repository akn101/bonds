import { test, expect } from "@playwright/test";
import { apiUrl } from "./api-base-url";

let counter = 0;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 6)}@example.com`;
}

type ApiResponse<T> = {
  data: T;
};

type ActivityCategory = {
  types?: Array<{ id?: number }>;
};

type ContactResponse = {
  id?: string;
};

async function setupVault(page: import("@playwright/test").Page) {
  const email = uniqueEmail("levt");
  await page.goto("/register");
  await page.getByPlaceholder("First name").fill("Activity");
  await page.getByPlaceholder("Last name").fill("Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/password/i).fill("password123");
  const createAccResp = page.waitForResponse(
    (resp) =>
      resp.url().includes("/auth/register") &&
      resp.request().method() === "POST" &&
      resp.status() < 400,
  );
  await page.getByRole("button", { name: /create account/i }).click();
  await createAccResp;
  await page.waitForURL(/\/vaults/);

  await page.getByRole("button", { name: /new vault/i }).click();
  await page.getByPlaceholder(/e\.g\. family/i).fill("LE Vault");
  await page
    .getByPlaceholder(/what is this vault/i)
    .fill("For activity testing");
  const createVaultResp = page.waitForResponse(
    (resp) =>
      resp.url().includes("/vaults") &&
      resp.request().method() === "POST" &&
      resp.status() < 400,
  );
  await page.getByRole("button", { name: /create vault/i }).click();
  await createVaultResp;
  await expect(page).toHaveURL(/\/vaults\/[a-f0-9-]{36}$/, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}

async function getVaultId(
  page: import("@playwright/test").Page,
): Promise<string> {
  const match = page.url().match(/\/vaults\/([a-f0-9-]{36})/);
  if (!match)
    throw new Error(`Could not extract vault ID from URL: ${page.url()}`);
  return match[1];
}

async function getAuthToken(
  page: import("@playwright/test").Page,
): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem("token"));
  if (!token) throw new Error("No auth token found in localStorage");
  return token;
}

async function createContactViaAPI(
  page: import("@playwright/test").Page,
  vaultId: string,
  token: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const resp = await page.request.post(apiUrl(`/vaults/${vaultId}/contacts`), {
    headers: { Authorization: `Bearer ${token}` },
    data: { first_name: firstName, last_name: lastName },
  });
  expect(resp.ok()).toBeTruthy();
  const body = (await resp.json()) as ApiResponse<ContactResponse>;
  if (!body.data.id)
    throw new Error(
      `Contact create response missing id for ${firstName} ${lastName}`,
    );
  return body.data.id;
}

async function getActivityTypeId(
  page: import("@playwright/test").Page,
  vaultId: string,
  token: string,
): Promise<number> {
  const resp = await page.request.get(
    apiUrl(`/vaults/${vaultId}/settings/activityCategories`),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(resp.ok()).toBeTruthy();
  const body = (await resp.json()) as ApiResponse<ActivityCategory[]>;
  const typeId = body.data
    .flatMap((category) => category.types ?? [])
    .find((type) => type.id)?.id;
  if (!typeId) throw new Error("No seeded activity type found");
  return typeId;
}

async function createParticipantActivityViaAPI(
  page: import("@playwright/test").Page,
  vaultId: string,
  token: string,
  contactId: string,
  participantId: string,
  typeId: number,
) {
  const activityResp = await page.request.post(
    apiUrl(`/vaults/${vaultId}/activities`),
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        activity_type_id: typeId,
        primary_contact_id: contactId,
        title: "Shared Summer Trip",
        start_date: "2026-06-20T00:00:00Z",
        start_precision: "day",
        end_status: "none",
        calendar_type: "gregorian",
        description: `Shared festival memory with @[BobLife Participant](contact:${participantId})`,
      },
    },
  );
  expect(activityResp.ok()).toBeTruthy();
}

async function navigateToContactActivities(
  page: import("@playwright/test").Page,
  vaultId: string,
  contactId: string,
) {
  await page.goto(`/vaults/${vaultId}/contacts/${contactId}`);
  await page.waitForLoadState("networkidle");
  const activitiesSection = page
    .getByRole("navigation", { name: "Contact sections" })
    .getByRole("button", { name: "Activities" });
  await expect(activitiesSection).toBeVisible({ timeout: 30000 });
  await activitiesSection.click();
  await page.waitForLoadState("networkidle");
}

async function expectParticipantActivityVisible(
  page: import("@playwright/test").Page,
  participantName: string,
) {
  const activitiesCard = page
    .locator(".ant-card")
    .filter({ hasText: "Activities" });
  await expect(
    activitiesCard.getByText("Shared Summer Trip", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    activitiesCard.getByRole("link", { name: participantName }),
  ).toBeVisible({ timeout: 30000 });
  await expect(activitiesCard.getByText(/Shared festival memory/)).toBeVisible({
    timeout: 30000,
  });
}

function getVaultUrl(page: import("@playwright/test").Page): string {
  return page.url();
}

async function navigateToActivitiesTab(page: import("@playwright/test").Page) {
  const vaultUrl = getVaultUrl(page);
  await page.goto(vaultUrl + "/settings");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".ant-tabs")).toBeVisible({ timeout: 30000 });
  await page.getByRole("tab", { name: /activities/i }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("Vault Settings - Activities", () => {
  test("should navigate to vault settings activities tab", async ({ page }) => {
    await setupVault(page);
    await navigateToActivitiesTab(page);
    await expect(page.getByText("Add Category")).toBeVisible({
      timeout: 30000,
    });
  });

  test("should show add category input and button", async ({ page }) => {
    await setupVault(page);
    await navigateToActivitiesTab(page);

    const addCard = page
      .locator(".ant-card")
      .filter({ hasText: "Add Category" });
    await expect(addCard).toBeVisible({ timeout: 30000 });
    await expect(addCard.getByPlaceholder(/name/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(addCard.getByRole("button", { name: /add/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test("should reorder activity categories via arrow buttons", async ({
    page,
  }) => {
    await setupVault(page);
    await navigateToActivitiesTab(page);

    // Wait for collapse panels (categories) to load
    await expect(page.locator(".ant-collapse-item").first()).toBeVisible({
      timeout: 30000,
    });

    // Get the second category panel
    const secondPanel = page.locator(".ant-collapse-item").nth(1);
    await expect(secondPanel).toBeVisible({ timeout: 5000 });

    // Find the UP arrow button in the second category's extra area
    const upArrow = secondPanel.locator("button", {
      has: page.locator(".anticon-arrow-up"),
    });
    await expect(upArrow).toBeVisible({ timeout: 5000 });

    // Click up arrow and wait for position API response
    const [posResp] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes("/activityCategories") &&
          resp.url().includes("/position") &&
          resp.request().method() === "POST" &&
          resp.status() < 400,
      ),
      upArrow.click(),
    ]);
    const posBody = await posResp.json();
    expect(posBody.success).toBe(true);

    // Wait for refetch to complete
    await page
      .waitForResponse(
        (resp) =>
          resp.url().includes("/activityCategories") &&
          resp.request().method() === "GET" &&
          resp.status() < 400,
        { timeout: 30000 },
      )
      .catch(() => null);
    await page.waitForLoadState("networkidle");

    // Verify: the UP arrow on the NEW first panel (previously second) should be disabled
    // because it's now at index 0
    const firstPanelUpArrow = page
      .locator(".ant-collapse-item")
      .first()
      .locator("button", { has: page.locator(".anticon-arrow-up") });
    await expect(firstPanelUpArrow).toBeDisabled({ timeout: 5000 });
  });

  test("should reorder activity types within a category via arrow buttons", async ({
    page,
  }) => {
    await setupVault(page);
    await navigateToActivitiesTab(page);
    const activitiesCard = page
      .locator(".ant-card")
      .filter({ hasText: "Activities" });
    await expect(activitiesCard).toBeVisible({ timeout: 30000 });
    const collapseItems = activitiesCard.locator(".ant-collapse-item");
    await expect(collapseItems.first()).toBeVisible({ timeout: 30000 });
    const firstPanel = collapseItems.first();
    await firstPanel.locator(".ant-collapse-header").click();

    const typeItems = firstPanel.locator(".ant-list-item");
    await expect(typeItems.first()).toBeVisible({ timeout: 15000 });
    const secondType = typeItems.nth(1);
    await expect(secondType).toBeVisible({ timeout: 5000 });
    const upArrow = secondType.locator("button", {
      has: page.locator(".anticon-arrow-up"),
    });
    await expect(upArrow).toBeVisible({ timeout: 5000 });
    const [posResp] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes("/position") &&
          resp.request().method() === "POST" &&
          resp.status() < 400,
      ),
      upArrow.click(),
    ]);
    const posBody = await posResp.json();
    expect(posBody.success).toBe(true);
    await page
      .waitForResponse(
        (resp) =>
          resp.url().includes("/activityCategories") &&
          resp.request().method() === "GET" &&
          resp.status() < 400,
        { timeout: 30000 },
      )
      .catch(() => null);
    await page.waitForLoadState("networkidle");
    // After refetch, panel may have closed — re-expand if needed
    const isExpanded = await firstPanel.evaluate((el) =>
      el.classList.contains("ant-collapse-item-active"),
    );
    if (!isExpanded) {
      await firstPanel.locator(".ant-collapse-header").click();
      await expect(firstPanel.locator(".ant-list-item").first()).toBeVisible({
        timeout: 15000,
      });
    }

    const refreshedFirstType = firstPanel.locator(".ant-list-item").first();
    const firstTypeUpArrow = refreshedFirstType.locator("button", {
      has: page.locator(".anticon-arrow-up"),
    });
    await expect(firstTypeUpArrow).toBeDisabled({ timeout: 5000 });
  });

  test("should delete a seeded activity type from settings", async ({
    page,
  }) => {
    await setupVault(page);
    await navigateToActivitiesTab(page);

    const activitiesCard = page
      .locator(".ant-card")
      .filter({ hasText: "Activities" });
    await expect(activitiesCard).toBeVisible({ timeout: 30000 });
    const firstPanel = activitiesCard.locator(".ant-collapse-item").first();
    await expect(firstPanel).toBeVisible({ timeout: 30000 });
    await firstPanel.locator(".ant-collapse-header").click();

    const typeItems = firstPanel.locator(".ant-list-item");
    await expect(typeItems.first()).toBeVisible({ timeout: 15000 });
    const initialCount = await typeItems.count();
    expect(initialCount).toBeGreaterThan(0);

    const deleteResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/settings/activityCategories/") &&
        resp.url().includes("/types/") &&
        resp.request().method() === "DELETE" &&
        resp.status() < 400,
    );
    await typeItems
      .first()
      .locator("button")
      .filter({ has: page.locator(".anticon-delete") })
      .click();
    await page
      .locator(".ant-popconfirm-buttons")
      .getByRole("button", { name: "OK" })
      .click();
    await deleteResp;

    await expect(firstPanel.locator(".ant-list-item")).toHaveCount(
      initialCount - 1,
      { timeout: 10000 },
    );
  });

  test("should delete a seeded activity category from settings", async ({
    page,
  }) => {
    await setupVault(page);
    await navigateToActivitiesTab(page);

    const categoryPanels = page.locator(".ant-collapse-item");
    await expect(categoryPanels.first()).toBeVisible({ timeout: 30000 });
    const initialCount = await categoryPanels.count();
    expect(initialCount).toBeGreaterThan(0);

    const deleteResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/settings/activityCategories/") &&
        !resp.url().includes("/types/") &&
        resp.request().method() === "DELETE" &&
        resp.status() < 400,
    );
    await categoryPanels.first().locator(".anticon-delete").first().click();
    await page
      .locator(".ant-popconfirm")
      .getByRole("button", { name: /ok|yes/i })
      .click();
    await deleteResp;

    await expect(page.locator(".ant-collapse-item")).toHaveCount(
      initialCount - 1,
      { timeout: 10000 },
    );
  });

  test("should show a mentioned activity on each associated contact", async ({
    page,
  }) => {
    await setupVault(page);
    const vaultId = await getVaultId(page);
    const token = await getAuthToken(page);
    const contactAId = await createContactViaAPI(
      page,
      vaultId,
      token,
      "AliceLife",
      "Host",
    );
    const contactBId = await createContactViaAPI(
      page,
      vaultId,
      token,
      "BobLife",
      "Participant",
    );
    const typeId = await getActivityTypeId(page, vaultId, token);

    await createParticipantActivityViaAPI(
      page,
      vaultId,
      token,
      contactAId,
      contactBId,
      typeId,
    );

    await navigateToContactActivities(page, vaultId, contactAId);
    await expectParticipantActivityVisible(page, "BobLife Participant");
    await page
      .getByRole("link", { name: "BobLife Participant" })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/vaults/${vaultId}/contacts/${contactBId}$`),
      { timeout: 10000 },
    );

    await navigateToContactActivities(page, vaultId, contactBId);
    await expectParticipantActivityVisible(page, "AliceLife Host");
  });
});

test.describe("Vault activity quick action", () => {
  test("uses activity wording and respects the default calendar preference", async ({
    page,
  }) => {
    await setupVault(page);

    await page.getByRole("button", { name: /Add activity/i }).click();

    const modal = page.locator(".ant-modal:visible");
    await expect(modal.locator(".ant-modal-title")).toHaveText("Add activity");
    await expect(modal.getByText("Title", { exact: true })).toBeVisible();
    await expect(modal.getByText("Gregorian", { exact: true })).toHaveCount(0);
    await expect(modal.getByText("Chinese Lunar", { exact: true })).toHaveCount(
      0,
    );
  });
});
