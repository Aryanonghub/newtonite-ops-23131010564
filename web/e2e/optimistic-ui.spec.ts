import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import crypto from 'node:crypto';

// Critical behaviour 7: optimistic UI reconciliation.
// The UI updates immediately, then rolls back and shows the server's reason on 409 / 403.

async function login(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { email, password: 'password123' } });
  expect(res.ok()).toBe(true);
  return (await res.json()).token;
}

// A fresh Payments item, so each test starts from a known state instead of relying on seed data.
async function createItem(request: APIRequestContext, status: 'open' | 'awaiting_approval'): Promise<number> {
  const headers = { Authorization: `Bearer ${await login(request, 'mohan@ops.test')}` };
  const res = await request.post('/api/items', {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: { title: `E2E item ${Date.now()}`, type: 'task', priority: 'high', team_id: 1 },
  });
  const item = await res.json();
  if (status === 'awaiting_approval') {
    await request.post(`/api/items/${item.id}/claim`, { headers });
    await request.post(`/api/items/${item.id}/transition`, { headers, data: { to: 'awaiting_approval', version: 2 } });
  }
  return item.id;
}

// A separate browser context = separate localStorage = a separate logged-in person (like incognito).
async function pageAs(browser: Browser, request: APIRequestContext, email: string): Promise<Page> {
  const token = await login(request, email);
  const context = await browser.newContext();
  await context.addInitScript((t) => localStorage.setItem('ops_token', t), token);
  return context.newPage();
}

const statusChip = (page: Page) => page.getByTestId('status-chip');
const successPopup = (page: Page) => page.locator('.MuiSnackbar-root');

test('second approver: UI rolls back and shows "This item changed, reload" (real 409)', async ({ browser, request }) => {
  const id = await createItem(request, 'awaiting_approval');
  const priya = await pageAs(browser, request, 'priya@ops.test'); // Lead, Payments
  const ada = await pageAs(browser, request, 'admin@ops.test');   // Admin
  for (const page of [priya, ada]) {
    await page.goto(`/items/${id}`);
    await expect(statusChip(page)).toHaveText('awaiting approval');
  }

  await priya.getByRole('button', { name: 'Approve' }).click();
  await expect(priya.getByText('Approved', { exact: true })).toBeVisible();

  // Ada's page is now stale (it still shows version 3).
  await ada.getByRole('button', { name: 'Approve' }).click();

  await expect(ada.getByText('This item changed, reload')).toBeVisible();
  await expect(ada.getByText('Priya (Payments Lead) approved it since you loaded this item.')).toBeVisible(); // names who
  await expect(statusChip(ada)).toHaveText('awaiting approval'); // rolled back
  await expect(successPopup(ada)).toHaveCount(0);                 // no false "Approved"

  await ada.getByRole('button', { name: 'Reload' }).click();
  await expect(statusChip(ada)).toHaveText('resolved');           // now shows the server's truth
  await expect(ada.getByText('This item changed, reload')).toHaveCount(0);
});

test('403: UI rolls back and shows the server’s reason', async ({ browser, request }) => {
  const id = await createItem(request, 'awaiting_approval');
  const priya = await pageAs(browser, request, 'priya@ops.test');
  // Simulate Priya losing her Lead role after the page loaded: the server answers 403.
  // (Faked in the browser so this test doesn't need database access; the real 403 is
  // covered by the server's authorization tests.)
  await priya.route(`**/api/items/${id}/transition`, (route) =>
    route.fulfill({ status: 403, json: { error: 'Your role in this team (member) cannot approve items' } }));

  await priya.goto(`/items/${id}`);
  await priya.getByRole('button', { name: 'Approve' }).click();

  await expect(priya.getByText('Your role in this team (member) cannot approve items')).toBeVisible();
  await expect(statusChip(priya)).toHaveText('awaiting approval'); // rolled back
  await expect(successPopup(priya)).toHaveCount(0);
});

test('claim updates the UI immediately, before the server answers', async ({ browser, request }) => {
  const id = await createItem(request, 'open');
  const sara = await pageAs(browser, request, 'sara@ops.test');
  let serverAnswered = false;
  // Hold the request for 1.5 s so we can see what the UI shows while waiting.
  await sara.route(`**/api/items/${id}/claim`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
    serverAnswered = true;
  });

  await sara.goto(`/items/${id}`);
  await expect(statusChip(sara)).toHaveText('open');
  await sara.getByRole('button', { name: 'Claim' }).click();

  await expect(statusChip(sara)).toHaveText('in progress'); // optimistic
  expect(serverAnswered).toBe(false);                       // ...while the server hasn't replied yet
  await expect(sara.getByText('You claimed this item')).toBeVisible(); // confirmed after the reply
  expect(serverAnswered).toBe(true);
});
