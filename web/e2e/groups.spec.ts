import { test, expect } from "@playwright/test";

let counter = 0;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 6)}@example.com`;
}

async function setupVault(
  page: import("@playwright/test").Page,
  prefix = "groups",
) {
  const email = uniqueEmail(prefix);
  await page.goto("/register");
  await page.getByPlaceholder("First name").fill("Groups");
  await page.getByPlaceholder("Last name").fill("Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/password/i).fill("password123");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/vaults/, { timeout: 15000 });

  await page.getByRole("button", { name: /new vault/i }).click();
  await page.getByPlaceholder(/e\.g\. family/i).fill("Groups Vault");
  await page.getByPlaceholder(/what is this vault/i).fill("For groups testing");
  await page.getByRole("button", { name: /create vault/i }).click();
  await expect(page).toHaveURL(/\/vaults\/[a-f0-9-]{36}$/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}

async function goToContacts(page: import("@playwright/test").Page) {
  // Issue #63: Dashboard 重写后 'View all contacts' 链接已移除，改用 URL 导航
  await page.goto(page.url().replace(/\/$/, "") + "/contacts");
  await expect(page).toHaveURL(/\/contacts/, { timeout: 5000 });
}

async function createContact(
  page: import("@playwright/test").Page,
  firstName: string,
  lastName: string,
): Promise<string> {
  await page.getByRole("button", { name: /add contact/i }).click();
  await page.getByPlaceholder("First name").fill(firstName);
  await page.getByPlaceholder("Last name").fill(lastName);
  await page.getByRole("button", { name: /create contact/i }).click();
  await expect(page).toHaveURL(/\/contacts\/[a-f0-9-]{36}$/, {
    timeout: 10000,
  });
  await expect(page.getByText(`${firstName} ${lastName}`).first()).toBeVisible({
    timeout: 10000,
  });

  const contactId = new URL(page.url()).pathname.match(
    /\/contacts\/([a-f0-9-]{36})$/,
  )?.[1];
  if (contactId === undefined) {
    throw new TypeError(
      `Contact detail URL does not contain a UUID: ${page.url()}`,
    );
  }
  return contactId;
}

async function navigateToTab(
  page: import("@playwright/test").Page,
  tabName: string,
) {
  const section = page
    .getByRole("navigation", { name: "Contact sections" })
    .getByRole("button", { name: tabName });
  await expect(section).toBeVisible({ timeout: 15000 });
  await section.click();
  await page.waitForLoadState("networkidle");
}

async function createGroup(
  page: import("@playwright/test").Page,
  vaultUrl: string,
  groupName: string,
) {
  await page.goto(vaultUrl + "/groups");
  await page.waitForLoadState("networkidle");

  await page
    .getByRole("button", { name: /new group/i })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 5000 });

  await modal.locator("input#name").fill(groupName);

  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes("/groups") && resp.request().method() === "POST",
  );
  await modal.getByRole("button", { name: /ok/i }).click();
  const resp = await responsePromise;
  expect(resp.status()).toBeLessThan(400);

  await expect(page.locator(".ant-list").getByText(groupName)).toBeVisible({
    timeout: 15000,
  });
}

function getVaultUrl(page: import("@playwright/test").Page): string {
  return page.url();
}

function expectContactIdsBody(
  actual: unknown,
  expectedContactIds: readonly string[],
  excludedContactId: string,
): void {
  if (
    typeof actual !== "object" ||
    actual === null ||
    !("contact_ids" in actual) ||
    !Array.isArray(actual.contact_ids)
  ) {
    throw new TypeError(
      "Batch group member request must contain a contact_ids array",
    );
  }
  expect(actual.contact_ids).toHaveLength(expectedContactIds.length);
  expect(actual.contact_ids).toEqual(
    expect.arrayContaining(expectedContactIds),
  );
  expect(actual.contact_ids).not.toContain(excludedContactId);
}

test.describe("Groups", () => {
  test("should navigate to groups page", async ({ page }) => {
    await setupVault(page, "grp-nav");
    const vaultUrl = getVaultUrl(page);
    await page.goto(vaultUrl + "/groups");
    await expect(
      page.getByRole("heading", { level: 4 }).getByText("Groups"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("should show empty groups list", async ({ page }) => {
    await setupVault(page, "grp-empty");
    const vaultUrl = getVaultUrl(page);
    await page.goto(vaultUrl + "/groups");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("No groups yet")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should show new group button", async ({ page }) => {
    await setupVault(page, "grp-btn");
    const vaultUrl = getVaultUrl(page);
    await page.goto(vaultUrl + "/groups");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("button", { name: /new group/i }).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("should create a new group", async ({ page }) => {
    await setupVault(page, "grp-create");
    const vaultUrl = getVaultUrl(page);
    await page.goto(vaultUrl + "/groups");
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("button", { name: /new group/i })
      .first()
      .click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByText("New Group")).toBeVisible();

    await modal.locator("input#name").fill("Family");

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/groups") && resp.request().method() === "POST",
    );
    await modal.getByRole("button", { name: /ok/i }).click();
    const resp = await responsePromise;
    expect(resp.status()).toBeLessThan(400);

    await expect(page.locator(".ant-list").getByText("Family")).toBeVisible({
      timeout: 15000,
    });
  });

  test("should navigate to group detail after clicking a group", async ({
    page,
  }) => {
    await setupVault(page, "grp-detail");
    const vaultUrl = getVaultUrl(page);
    await page.goto(vaultUrl + "/groups");
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("button", { name: /new group/i })
      .first()
      .click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.locator("input#name").fill("Friends");

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/groups") && resp.request().method() === "POST",
    );
    await modal.getByRole("button", { name: /ok/i }).click();
    await responsePromise;

    await expect(page.locator(".ant-list").getByText("Friends")).toBeVisible({
      timeout: 15000,
    });
    await page.locator(".ant-list").getByText("Friends").click();
    await expect(page).toHaveURL(/\/groups\/\d+$/, { timeout: 10000 });
  });
});

test.describe("Groups - Member Count", () => {
  test("member count updates after adding contact to group", async ({
    page,
  }) => {
    await setupVault(page, "grp-memcount");
    const vaultUrl = getVaultUrl(page);

    // Create a group
    await createGroup(page, vaultUrl, "Family");

    // Navigate back to vault, create a contact
    await page.goto(vaultUrl);
    await page.waitForLoadState("networkidle");
    await goToContacts(page);
    await createContact(page, "Alice", "Test");

    await navigateToTab(page, "Social");
    // Wait for tab content to load
    await page.waitForTimeout(1000);
    // Use h5 heading to precisely match the Groups card (avoid matching tab name)
    const groupsCard = page.locator(".ant-card").filter({
      has: page.locator("h5", { hasText: "Groups" }),
    });
    await expect(groupsCard).toBeVisible({ timeout: 15000 });
    await groupsCard.getByRole("button", { name: /add/i }).click();

    // Wait for the modal with group selector
    const groupModal = page.locator(".ant-modal:visible");
    await expect(groupModal).toBeVisible({ timeout: 5000 });

    // Select the "Family" group from dropdown
    await groupModal.locator(".ant-select").click();
    await page
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: "Family" })
      .click();

    // Save
    const addResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/groups") && resp.request().method() === "POST",
    );
    await groupModal.getByRole("button", { name: /save/i }).click();
    const resp = await addResp;
    expect(resp.status()).toBeLessThan(400);

    // Verify the tag appears
    await expect(
      groupsCard.locator(".ant-tag").filter({ hasText: "Family" }),
    ).toBeVisible({ timeout: 10000 });

    // Navigate to groups list and verify member count
    await page.goto(vaultUrl + "/groups");
    await page.waitForLoadState("networkidle");

    const familyGroup = page
      .locator(".ant-list-item")
      .filter({ hasText: "Family" });
    await expect(familyGroup).toBeVisible({ timeout: 10000 });
    await expect(familyGroup.getByText(/1\s*member/i)).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Groups - Batch Member Management (Issue #211)", () => {
  test("searches, batch adds, selects, and batch removes group members", async ({
    page,
  }) => {
    await setupVault(page, "grp-batch-members");
    const vaultUrl = getVaultUrl(page);
    const scenarioKey = `${Date.now()}-${++counter}`;
    const sharedLastName = `Issue211Member${scenarioKey}`;
    const firstContactName = `Alpha${scenarioKey} ${sharedLastName}`;
    const secondContactName = `Beta${scenarioKey} ${sharedLastName}`;
    const neverAddedContactName = `Gamma${scenarioKey} ${sharedLastName}`;
    const groupName = `Issue 211 Batch ${scenarioKey}`;

    await goToContacts(page);
    const firstContactId = await createContact(
      page,
      `Alpha${scenarioKey}`,
      sharedLastName,
    );
    await page.goto(`${vaultUrl}/contacts`);
    const secondContactId = await createContact(
      page,
      `Beta${scenarioKey}`,
      sharedLastName,
    );
    await page.goto(`${vaultUrl}/contacts`);
    const neverAddedContactId = await createContact(
      page,
      `Gamma${scenarioKey}`,
      sharedLastName,
    );

    await createGroup(page, vaultUrl, groupName);
    await page
      .locator(".ant-list")
      .getByText(groupName, { exact: true })
      .click();
    await expect(page).toHaveURL(/\/vaults\/[a-f0-9-]{36}\/groups\/\d+$/, {
      timeout: 10000,
    });

    const detailPath = new URL(page.url()).pathname;
    const detailMatch =
      /^\/vaults\/(?<vaultId>[a-f0-9-]{36})\/groups\/(?<groupId>\d+)$/.exec(
        detailPath,
      );
    const vaultId = detailMatch?.groups?.vaultId;
    const groupId = detailMatch?.groups?.groupId;
    if (vaultId === undefined || groupId === undefined) {
      throw new TypeError(
        `Group detail URL has an unexpected path: ${detailPath}`,
      );
    }
    const memberEndpointPath = `/api/vaults/${vaultId}/groups/${groupId}/members`;
    let matchingPostCount = 0;
    let matchingDeleteCount = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname !== memberEndpointPath) return;
      if (request.method() === "POST") matchingPostCount += 1;
      if (request.method() === "DELETE") matchingDeleteCount += 1;
    });

    await page.getByRole("button", { name: "Add Members" }).click();
    const addPanel = page.getByRole("region", {
      name: "Select contacts",
    });
    const contactSearch = addPanel.getByRole("searchbox", {
      name: /search contacts/i,
    });

    await contactSearch.fill(`Alpha${scenarioKey}`);
    await addPanel
      .getByRole("checkbox", { name: `Select ${firstContactName}` })
      .check();
    await expect(
      addPanel.getByText("1 selected", { exact: true }),
    ).toBeVisible();

    await contactSearch.fill(`Beta${scenarioKey}`);
    await expect(
      addPanel.getByText("1 selected", { exact: true }),
    ).toBeVisible();
    await addPanel
      .getByRole("checkbox", { name: `Select ${secondContactName}` })
      .check();
    await expect(
      addPanel.getByText("2 selected", { exact: true }),
    ).toBeVisible();

    await contactSearch.fill(sharedLastName);
    await expect(
      addPanel.getByRole("checkbox", { name: `Select ${firstContactName}` }),
    ).toBeChecked();
    await expect(
      addPanel.getByRole("checkbox", { name: `Select ${secondContactName}` }),
    ).toBeChecked();
    await expect(
      addPanel.getByRole("checkbox", {
        name: `Select ${neverAddedContactName}`,
      }),
    ).not.toBeChecked();

    const addResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === memberEndpointPath,
    );
    await addPanel.getByRole("button", { name: "Add selected" }).click();
    const addResponse = await addResponsePromise;

    expect(addResponse.status()).toBeLessThan(400);
    expectContactIdsBody(
      addResponse.request().postDataJSON(),
      [firstContactId, secondContactId],
      neverAddedContactId,
    );
    const addResponseBody: unknown = await addResponse.json();
    expect(addResponseBody).toEqual({
      success: true,
      data: { affected_count: 2 },
    });
    await expect(
      page.getByRole("link", { name: firstContactName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: secondContactName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: neverAddedContactName, exact: true }),
    ).toHaveCount(0);
    expect(matchingPostCount).toBe(1);

    const memberSearch = page.getByRole("searchbox", {
      name: "Search members",
    });
    await memberSearch.fill(sharedLastName);
    await expect(
      page.getByRole("link", { name: firstContactName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: secondContactName, exact: true }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all visible" }).check();
    await expect(
      page.getByRole("checkbox", { name: `Select ${firstContactName}` }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: `Select ${secondContactName}` }),
    ).toBeChecked();

    await page.getByRole("button", { name: "Remove selected" }).click();
    const deleteResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === memberEndpointPath,
    );
    await page
      .locator(".ant-popconfirm")
      .getByRole("button", { name: /ok|yes/i })
      .click();
    const deleteResponse = await deleteResponsePromise;

    expect(deleteResponse.status()).toBeLessThan(400);
    expectContactIdsBody(
      deleteResponse.request().postDataJSON(),
      [firstContactId, secondContactId],
      neverAddedContactId,
    );
    const deleteResponseBody: unknown = await deleteResponse.json();
    expect(deleteResponseBody).toEqual({
      success: true,
      data: { affected_count: 2 },
    });
    expect(matchingDeleteCount).toBe(1);

    await memberSearch.clear();
    await expect(
      page.getByRole("link", { name: firstContactName, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: secondContactName, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: neverAddedContactName, exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("No members", { exact: true })).toBeVisible();
  });
});

test.describe("Groups - Group Type", () => {
  test("create group form has group type selector", async ({ page }) => {
    await setupVault(page, "grp-typsel");
    const vaultUrl = getVaultUrl(page);

    await page.goto(vaultUrl + "/groups");
    await page.waitForLoadState("networkidle");

    // Open new group modal
    await page
      .getByRole("button", { name: /new group/i })
      .first()
      .click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Assert: the modal contains a "Group Type" label/field
    await expect(
      modal.locator("label").filter({ hasText: "Group Type" }),
    ).toBeVisible({ timeout: 5000 });

    // Assert: there's a Select component for group type
    const groupTypeSelect = modal
      .locator(".ant-form-item")
      .filter({ hasText: "Group Type" })
      .locator(".ant-select");
    await expect(groupTypeSelect).toBeVisible({ timeout: 5000 });

    // Fill name only, leave group type empty, submit
    await modal.locator("input#name").fill("Test Group");

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/groups") && resp.request().method() === "POST",
    );
    await modal.getByRole("button", { name: /ok/i }).click();
    const resp = await responsePromise;
    expect(resp.status()).toBeLessThan(400);

    // Verify the group was created
    await expect(page.locator(".ant-list").getByText("Test Group")).toBeVisible(
      { timeout: 15000 },
    );
  });
});
