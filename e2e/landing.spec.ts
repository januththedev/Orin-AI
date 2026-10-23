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
