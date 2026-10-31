import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * The minimum meaningful product journey:
 * set up the server, create a family circle, invite someone, they share a
 * location, and the first person sees it live on the map and in history.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = { name: 'Morgan Admin', email: 'morgan@example.com', password: 'correct horse battery' };
const KID = { name: 'Riley Kid', email: 'riley@example.com', password: 'another good passphrase' };
let inviteUrl = '';

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function geoContext(browser: Browser, lat: number, lon: number) {
  return browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: lat, longitude: lon, accuracy: 8 } });
}

test('first run: set up the administrator', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'setup runs once');
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Your name').fill(ADMIN.name);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('heading', { name: /Morgan/ })).toBeVisible();
});

test('create a family circle and an invitation link', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'runs once');
  await signIn(page, ADMIN);
  await page.goto('/circles?new=1');
  await page.getByLabel('Name').fill('Family');
  await page.getByRole('button', { name: 'Create circle' }).click();
  // Lands on the circle with the invite dialog open.
  await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const link = page.locator('.font-mono').first();
  await expect(link).toContainText('/join/');
  inviteUrl = (await link.textContent())!.trim();
});

test('invited person registers, joins and shares their location', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'runs once');
  const ctx = await geoContext(browser, 44.6488, -63.5752);
  const page = await ctx.newPage();
  await page.goto(new URL(inviteUrl).pathname);
  await expect(page.getByRole('heading', { name: 'Join Family' })).toBeVisible();
  await page.getByLabel('Your name').fill(KID.name);
  await page.getByLabel('Email').fill(KID.email);
  await page.getByLabel('Password').fill(KID.password);
  await page.getByRole('button', { name: 'Create account & join' }).click();
  await expect(page.getByRole('heading', { name: /Riley/ })).toBeVisible();
  // Refresh the mocked fix so its timestamp is after joining the circle.
  await ctx.setGeolocation({ latitude: 44.6488, longitude: -63.5752, accuracy: 8 });
  await page.getByRole('button', { name: 'Start sharing' }).click();
  await expect(page.getByText('Sharing live').first()).toBeVisible({ timeout: 15_000 });
  // Wait until the fix has been uploaded.
  await expect.poll(async () => (await page.request.get('/api/live')).json().then((m: { location: unknown }[]) => m.some((x) => x.location)), { timeout: 15_000 }).toBe(true);
  await ctx.close();
});

test('the admin sees the shared location on the map and in history', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/map');
  await expect(page.getByText(KID.name).first()).toBeVisible();
  await page.getByText(KID.name).first().click();
  await expect(page.getByRole('heading', { name: KID.name })).toBeVisible();
  await expect(page.getByText('44.64880, -63.57520').first()).toBeVisible();
  await page.locator('a[href*="/history?member="]').first().click();
  await expect(page).toHaveURL(/\/history\?member=/);
  await expect(page.getByText(/Points/i).first()).toBeVisible();
});

test('a stranger cannot read the circle', async ({ page }) => {
  const res = await page.request.get('/api/live');
  expect(res.status()).toBe(401);
});
