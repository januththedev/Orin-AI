import { test, expect } from "@playwright/test";

test("public landing opens chat with the chosen starting prompt", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "A little clarity.",
  );
  await page.getByRole("tab", { name: "Find the words" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Help me say this");
  await page.getByRole("button", { name: "Start with this" }).click();
  await expect(page).toHaveURL(/#chat$/);
  await expect(page.getByLabel("Message Orin")).toHaveValue(
    /Help me write something/,
  );
});

test("landing FAQ and keyboard-operated example tabs work", async ({
  page,
}) => {
  await page.goto("/");
  const tab = page.getByRole("tab", { name: "Make a plan" });
  await tab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Find the words" }),
  ).toHaveAttribute("aria-selected", "true");
  const question = page.getByRole("button", {
    name: "Can I use my own language?",
  });
  await question.click();
  await expect(question).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#lp-faq-1")).toContainText("Sinhala");
});

test("mobile landing has working navigation and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Good questions" })
    .click();
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(
    await page
      .locator(".orin-landing")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "Let’s see where it goes" }).click();
  await expect(page.getByLabel("Message Orin")).toBeVisible();
});

test("landing sign-in opens the configured auth entry path", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/#chat$/);
  // The test build intentionally has no Clerk credentials.
  await expect(
    page.getByRole("dialog", { name: "Make yourself at home" }),
  ).toBeVisible();
});

test("admin entry is visible and uses a password without a Clerk account", async ({ page }) => {
  await page.route("**/api/workspace", async (route) => {
    const { action } = route.request().postDataJSON();
    await route.fulfill({ json: action === "admin.session" ? { authenticated: false, configured: true } : { error: "Incorrect admin password." }, status: action === "admin.session" ? 200 : 401 });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByLabel("Admin password")).toBeVisible();
  await page.getByLabel("Admin password").fill("wrong-password");
  await page.getByRole("button", { name: "Open administration" }).click();
  await expect(page.getByRole("alert")).toContainText("Incorrect admin password");
  await expect(page.getByLabel("Admin password")).toHaveValue("");
  await page.goto("/#admin");
  await expect(page.getByLabel("Admin password")).toBeVisible();
});

test("refresh recovery loads the latest page and preserves saved history and preferences", async ({ page }) => {
  await page.route("**/api/version", route => route.fulfill({ json: { v: "different-server-version" } }));
  await page.route("**/api/workspace", route => route.fulfill({ json: { authenticated: false, configured: true } }));
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.setItem("orin_app_v", "legacy-browser-version");
    localStorage.setItem("orin-saved-history-check", "preserve-my-chats");
    sessionStorage.setItem("orin-draft-check", "preserve-my-draft");
    await (await caches.open("orin-ai-stale-test")).put("/old-app.js", new Response("old"));
    await caches.open("unrelated-app-cache");
  });
  await page.goto("/refresh.html?next=/admin");
  await expect(page).toHaveURL(/\/admin\?app-refresh=\d+$/);
  await expect(page.getByLabel("Admin password")).toBeVisible();
  const result = await page.evaluate(async () => ({
    version: localStorage.getItem("orin_app_v"),
    history: localStorage.getItem("orin-saved-history-check"),
    draft: sessionStorage.getItem("orin-draft-check"),
    caches: await caches.keys(),
  }));
  expect(result.version).toBe("legacy-browser-version");
  expect(result.history).toBe("preserve-my-chats");
  expect(result.draft).toBe("preserve-my-draft");
  expect(result.caches).not.toContain("orin-ai-stale-test");
  expect(result.caches).toContain("unrelated-app-cache");
  await page.goto("/refresh.html?next=https://other.example/admin");
  await expect(page).toHaveURL(/127\.0\.0\.1:4173\/\?app-refresh=\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A little clarity.");
});
