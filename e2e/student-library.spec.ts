import { test, expect } from "@playwright/test";
test("student library searches levels and Sinhala aliases, practises, and preserves self-review", async ({
  page,
}) => {
  await page.goto("/learn");
  await expect(page.locator(".study-card")).toHaveCount(58);
  await page.getByRole("button", { name: "A/L", exact: true }).click();
  await expect(page.locator(".study-card")).toHaveCount(30);
  await page.getByRole("textbox", { name: "Search study packs" }).fill("ගණිතය");
  await expect(page.locator(".study-card")).toHaveCount(2);
  await page.locator(".study-card").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("teacher review pending");
  await dialog
    .getByRole("button", { name: "Practise questions", exact: true })
    .click();
  await expect(dialog.locator(".study-reference")).toHaveCount(0);
  await dialog.getByLabel("Try your answer first").fill("My attempt");
  await dialog.getByRole("button", { name: "Show reference answer" }).click();
  await expect(dialog.locator(".study-reference")).toContainText("3x²");
  await dialog.getByRole("button", { name: "Mark as self-reviewed" }).click();
  await expect(dialog).toContainText("not an automatic grade");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "1 self-reviewed questions",
  );
});
test("student questions open chat and all download formats resolve as data", async ({
  page,
}) => {
  await page.goto("/learn?pack=ol-math-algebra");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Practise questions", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Work through this with Orin" })
    .click();
  await expect(page).toHaveURL(/\/#chat$/);
  await expect(page.getByLabel("Message Orin")).toHaveValue(
    /Mathematics: algebra/,
  );
  const zip = await page.request.get(
    "/student-knowledge/orin-student-knowledge.zip",
  );
  expect(zip.ok()).toBe(true);
  expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
  const lines = (
    await (await page.request.get("/student-knowledge/records.jsonl")).text()
  )
    .trim()
    .split("\n");
  expect(lines).toHaveLength(332);
  expect(JSON.parse(lines[0]).reviewStatus).toBe("teacher-review-pending");
  const md = await (
    await page.request.get("/student-knowledge/md/ol-math-algebra.md")
  ).text();
  expect(md).toContain("x = 5");
  expect(md).toContain("References and source-access limits");
});
test("mobile library has accessible search, empty-state recovery and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/learn");
  await expect(page.locator(".study-card")).toHaveCount(58);
  await page
    .getByRole("textbox", { name: "Search study packs" })
    .fill("no-matching-subject-here");
  await expect(
    page.getByRole("heading", { name: "No exact match yet." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all packs" }).click();
  await expect(page.locator(".study-card")).toHaveCount(58);
  expect(
    await page
      .locator(".student-library")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.locator(".study-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "Close study pack" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
