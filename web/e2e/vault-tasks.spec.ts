import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { apiUrl } from "./api-base-url";

async function registerAndCreateVault(page: Page): Promise<string> {
  const email = `vault-tasks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/register");
  await page.getByPlaceholder("First name").fill("Vault");
  await page.getByPlaceholder("Last name").fill("Tasks");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/password/i).fill("password123");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/vaults/, { timeout: 15000 });

  await page.getByRole("button", { name: /new vault/i }).click();
  await page.getByPlaceholder(/e\.g\. family/i).fill("Task List Regression");
  await page
    .getByPlaceholder(/what is this vault/i)
    .fill("Virtual list hard refresh regression");
  await page.getByRole("button", { name: /create vault/i }).click();
  await expect(page).toHaveURL(/\/vaults\/[a-f0-9-]{36}$/, { timeout: 20000 });

  const vaultId = page.url().split("/").at(-1);
  if (!vaultId) {
    throw new Error("Vault ID was not available after creation");
  }
  return vaultId;
}

async function createTaskFixture(page: Page, vaultId: string): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem("token"));
  if (!token) {
    throw new Error("Auth token was not available after registration");
  }
  const headers = { Authorization: `Bearer ${token}` };

  for (let index = 1; index <= 20; index += 1) {
    const response = await page.request.post(
      apiUrl(`/vaults/${vaultId}/tasks`),
      {
        headers,
        data: {
          label: `Pending hard refresh task ${index}`,
          description: "Pending task description",
          due_at: "2026-08-15T10:00:00Z",
          status: "todo",
        },
      },
    );
    expect(response.ok()).toBe(true);
  }

  const completedCreate = await page.request.post(
    apiUrl(`/vaults/${vaultId}/tasks`),
    {
      headers,
      data: { label: "Completed hard refresh task", status: "todo" },
    },
  );
  expect(completedCreate.ok()).toBe(true);
  const completedBody = await completedCreate.json();
  const completedTaskId = completedBody.data.id;

  const completedUpdate = await page.request.patch(
    apiUrl(`/vaults/${vaultId}/tasks/${completedTaskId}`),
    {
      headers,
      data: { label: "Completed hard refresh task", status: "done" },
    },
  );
  expect(completedUpdate.ok()).toBe(true);
}

async function expectCompletedTaskAfterHardRefresh(page: Page): Promise<void> {
  await page.reload();
  await expectVirtuosoListToBeMeasurable(page);
  await expect(
    page.getByText("Pending hard refresh task 20", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );

  const completedTask = page.getByText("Completed hard refresh task", {
    exact: true,
  });
  await expect(completedTask).toBeVisible({ timeout: 10000 });
  const geometry = await completedTask.evaluate((element) =>
    element.getBoundingClientRect(),
  );
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.height).toBeGreaterThan(0);
}

async function expectVirtuosoListToBeMeasurable(page: Page): Promise<void> {
  const scroller = page.locator('[data-virtuoso-scroller="true"]');
  const viewport = page.locator("[data-viewport-type]");
  const firstItem = page.locator("[data-item-index]").first();

  await expect
    .poll(
      () =>
        scroller.evaluate((element) => element.getBoundingClientRect().height),
      {
        message: "Virtuoso scroller must not collapse to zero height",
      },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        viewport.evaluate((element) => element.getBoundingClientRect().height),
      {
        message: "Virtuoso viewport must not collapse to zero height",
      },
    )
    .toBeGreaterThan(0);
  await expect(
    firstItem,
    "Virtuoso must render at least one measurable task row",
  ).toBeVisible();
  const firstItemGeometry = await firstItem.evaluate((element) =>
    element.getBoundingClientRect(),
  );
  expect(firstItemGeometry.height).toBeGreaterThan(0);
}

async function expectTaskEditAfterListTransition(page: Page): Promise<void> {
  await page
    .locator(".ant-list-item")
    .filter({ hasText: "Pending hard refresh task 20" })
    .click({ position: { x: 8, y: 8 } });
  const editDialog = page.getByRole("dialog");
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole("textbox").first()).toHaveValue(
    "Pending hard refresh task 20",
  );
  await page.getByRole("button", { name: /cancel/i }).click();
}

test("list view stays measurable after hard refresh and Kanban transitions", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (
      /\/api\/vaults\/[^/]+\/tasks(?:[/?]|$)/.test(request.url()) &&
      request.failure()?.errorText !== "net::ERR_ABORTED"
    ) {
      failedRequests.push(request.url());
    }
  });

  const vaultId = await registerAndCreateVault(page);
  await createTaskFixture(page, vaultId);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/vaults/${vaultId}/tasks`);

  await expectCompletedTaskAfterHardRefresh(page);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByText("Kanban", { exact: true }).click();
  await expect(
    page.getByText("Pending hard refresh task 1", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("List", { exact: true }).click();
  await expectVirtuosoListToBeMeasurable(page);
  await expectTaskEditAfterListTransition(page);

  await page.setViewportSize({ width: 768, height: 900 });
  await expectCompletedTaskAfterHardRefresh(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByText("Kanban", { exact: true }).click();
  await expect(
    page.getByText("Pending hard refresh task 1", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("List", { exact: true }).click();
  await expectVirtuosoListToBeMeasurable(page);
  await expectTaskEditAfterListTransition(page);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(
    page.getByText("Completed hard refresh task", { exact: true }),
  ).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 375, height: 812 });
  await expectCompletedTaskAfterHardRefresh(page);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByText("Kanban", { exact: true }).click();
  await expect(
    page.getByText("Pending hard refresh task 1", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("List", { exact: true }).click();
  await expectVirtuosoListToBeMeasurable(page);
  await expectTaskEditAfterListTransition(page);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
