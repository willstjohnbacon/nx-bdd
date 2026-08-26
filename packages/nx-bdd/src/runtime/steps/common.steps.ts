/**
 * Base Given/When/Then steps shared by every BDD suite in the organisation.
 *
 * Importing this module registers the steps as a side effect, which is why it
 * lives behind the `@willstjohnbacon/nx-bdd/steps` entry point rather than the
 * package root.
 */
import { Given, Then, When, expect } from '../fixtures';

Given('I am on the {string} page', async ({ page }, path: string) => {
  await page.goto(path);
});

Given('I am logged in as an admin', async ({ loginAs, adminRole }) => {
  await loginAs(adminRole);
});

Given('I am logged in as {string}', async ({ loginAs }, role: string) => {
  await loginAs(role);
});

When('I navigate to {string}', async ({ page }, path: string) => {
  await page.goto(path);
});

When('I click {string}', async ({ page }, name: string) => {
  await page.getByRole('button', { name }).or(page.getByRole('link', { name })).click();
});

When('I fill in {string} with {string}', async ({ page }, label: string, value: string) => {
  await page.getByLabel(label).fill(value);
});

Then('I should see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text).first()).toBeVisible();
});

Then('I should not see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).toHaveCount(0);
});

Then('I should be on the {string} page', async ({ page }, path: string) => {
  await expect(page).toHaveURL(new RegExp(`${escapeForRegExp(path)}/?$`));
});

Then('the page title should be {string}', async ({ page }, title: string) => {
  await expect(page).toHaveTitle(title);
});

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
