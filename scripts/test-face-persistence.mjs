import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BASE = 'http://localhost:5000';
const TEST_USER_ID = 'persist-test-user';
const LAYLA_ACCOUNT_ID = 21;

function makeTempPng() {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  const p = path.join(os.tmpdir(), `face-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(p, bytes);
  return p;
}

function intercept(page, accountId, getUserId) {
  page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();

    if (url.includes('/api/auth/user')) {
      const uid = typeof getUserId === 'function' ? getUserId() : TEST_USER_ID;
      return req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: uid, email: `${uid}@test`, authProvider: 'email' }),
      });
    }
    if (url.endsWith('/api/accounts') || url.endsWith('/api/accounts/')) {
      const uid = typeof getUserId === 'function' ? getUserId() : TEST_USER_ID;
      return req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: accountId, name: 'Belladonna House of Beauty', businessName: 'Belladonna', plan: 'pro', status: 'active', ownerId: uid },
        ]),
      });
    }
    if (url.includes('/api/notifications')) {
      return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('/api/social-accounts')) {
      return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return req.continue();
  });
}

function logErrors(page, label) {
  page.on('pageerror', (e) => console.error(`[${label}] pageerror:`, e.message));
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') console.log(`[${label}] console.${t}:`, m.text());
  });
}

async function uploadFile(page, filePath) {
  const inputs = await page.$$('input[type=file]');
  if (!inputs.length) throw new Error('No file input found');
  await inputs[0].uploadFile(filePath);
}

async function waitForFaceVisible(page) {
  await page.waitForSelector('[data-testid="img-face-preview"]', { timeout: 8000 });
}

async function clearLocalState(page) {
  await page.evaluate(async () => {
    if (typeof indexedDB === 'undefined') return;
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('layla_studio');
      req.onsuccess = () => resolve(null);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  });
}

async function setActiveAccount(page, id) {
  await page.evaluate((accountId) => {
    localStorage.setItem('apex_active_account', String(accountId));
  }, id);
}

async function readIdbBlobSize(page) {
  return page.evaluate((userId) => {
    return new Promise((resolve) => {
      const open = indexedDB.open('layla_studio', 1);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('face_refs', 'readonly');
        const req = tx.objectStore('face_refs').get(`face:${userId}`);
        req.onsuccess = () => {
          const v = req.result;
          db.close();
          resolve(v ? { size: v.blob.size, name: v.name, type: v.type } : null);
        };
        req.onerror = () => { db.close(); resolve(null); };
      };
      open.onerror = () => resolve(null);
    });
  }, TEST_USER_ID);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const results = [];
  let exitCode = 0;
  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    let activeUserId = TEST_USER_ID;
    intercept(page, LAYLA_ACCOUNT_ID, () => activeUserId);
    logErrors(page, 'page1');

    // Land on dashboard first to set active account, then navigate to studio
    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await setActiveAccount(page, LAYLA_ACCOUNT_ID);
    await clearLocalState(page);

    await page.goto(BASE + '/dashboard/layla-studio', { waitUntil: 'networkidle0', timeout: 30000 });

    // Make sure the Layla tab is active
    const onLaylaTab = await page.$('[data-testid="tab-layla"]');
    if (!onLaylaTab) throw new Error('Did not reach Layla studio (tab missing)');

    // Should NOT yet have a face preview
    const preExisting = await page.$('[data-testid="img-face-preview"]');
    results.push({ step: 'no-face-on-fresh-mount', pass: !preExisting });

    // Upload a face
    const tmpFile = makeTempPng();
    await uploadFile(page, tmpFile);
    await waitForFaceVisible(page);
    results.push({ step: 'face-shows-after-upload', pass: true });

    // Confirm IndexedDB has it
    const stored = await readIdbBlobSize(page);
    results.push({ step: 'face-persisted-to-idb', pass: !!stored && stored.size > 0, detail: stored });

    // Reload the page and verify face is rehydrated from IndexedDB
    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    // Make sure we're on the Layla tab (default is layla)
    await page.waitForSelector('[data-testid="tab-layla"]', { timeout: 8000 });
    try {
      await waitForFaceVisible(page);
      results.push({ step: 'face-rehydrates-after-reload', pass: true });
    } catch (e) {
      results.push({ step: 'face-rehydrates-after-reload', pass: false, error: e.message });
    }

    // Clear face and verify persisted copy is removed
    const clearBtn = await page.$('[data-testid="button-clear-face"]');
    if (!clearBtn) {
      results.push({ step: 'clear-button-present', pass: false });
    } else {
      results.push({ step: 'clear-button-present', pass: true });
      // Use DOM .click() via evaluate — puppeteer's elementHandle.click()
      // sometimes misses buttons positioned at the bottom of a card.
      await page.evaluate(() => {
        const b = document.querySelector('[data-testid="button-clear-face"]');
        if (b instanceof HTMLElement) b.click();
      });
      // Wait for the face thumbnail to disappear from the DOM (state update),
      // then poll IDB for up to 3s for the deletion transaction to complete.
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="img-face-preview"]'),
        { timeout: 3000 },
      ).catch(() => {});
      let cleared = await readIdbBlobSize(page);
      const deadline = Date.now() + 3000;
      while (cleared !== null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        cleared = await readIdbBlobSize(page);
      }
      results.push({ step: 'face-removed-from-idb-after-clear', pass: cleared === null, detail: cleared });
      // Reload, no face should appear
      await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector('[data-testid="tab-layla"]', { timeout: 8000 });
      await new Promise((r) => setTimeout(r, 800));
      const stillThere = await page.$('[data-testid="img-face-preview"]');
      results.push({ step: 'no-face-on-reload-after-clear', pass: !stillThere });
    }

    // Per-operator scoping — same browser, different operator must NOT see the face
    // Re-upload for the original operator first
    await uploadFile(page, makeTempPng());
    await waitForFaceVisible(page);

    // Switch the mocked auth user, reload, expect no face for the new operator
    activeUserId = 'different-operator';
    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('[data-testid="tab-layla"]', { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 800));
    const otherUserSeesFace = await page.$('[data-testid="img-face-preview"]');
    results.push({ step: 'per-operator-scoped', pass: !otherUserSeesFace });

    // And the original user's face should still exist in IDB under their own key
    const stillStored = await readIdbBlobSize(page);
    results.push({
      step: 'original-operator-face-still-in-idb',
      pass: !!stillStored && stillStored.size > 0,
      detail: stillStored,
    });
  } catch (err) {
    console.error('Test crashed:', err);
    exitCode = 1;
  } finally {
    await browser.close();
  }

  console.log('\n=== RESULTS ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.step}${r.detail ? '  ' + JSON.stringify(r.detail) : ''}${r.error ? '  ' + r.error : ''}`);
    if (!r.pass) exitCode = 1;
  }
  process.exit(exitCode);
}

main();
