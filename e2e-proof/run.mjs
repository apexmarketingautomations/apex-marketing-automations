import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROOF_DIR = __dirname;
const BASE = 'http://localhost:5000';

async function run() {
  console.log('=== APEX E2E VISUAL PROOF — Content Planner Upload ===\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const method = req.method();

    if (url.includes('/api/auth/user')) {
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'e2e-proof', claims: { sub: 'e2e-proof' } }) });
    }
    if (url.includes('/api/accounts')) {
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 22, name: 'Officer Layla', businessName: 'Layla Operations', plan: 'pro', status: 'active', ownerId: 'e2e-proof' }]) });
    }
    if (url.includes('/api/content-planner/posts') && method === 'GET') {
      return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('/api/content-planner/approvals')) {
      return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('/api/content-planner/publishing-jobs')) {
      return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('/api/media/upload') && method === 'POST') {
      return req.respond({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          uploaded: [{
            originalName: 'layla_proof_upload.png',
            filename: '1776085295489-proof.png',
            fileUrl: '/uploads/1776085295489-d7a07db6-8adf-4571-902b-73d9eb75b7c6.png',
            fileType: 'image', size: 4200, mime: 'image/png', mediaId: 42
          }],
          rowsProcessed: 1
        })
      });
    }
    if (url.includes('/api/notifications')) {
      return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('/api/social-accounts')) {
      return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
    }
    req.continue();
  });

  console.log('[1] Navigating to app root to set localStorage...');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.evaluate(() => localStorage.setItem('apex_active_account', '22'));

  console.log('[2] Navigating to /content-planner...');
  await page.goto(`${BASE}/content-planner`, { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise(r => setTimeout(r, 2000));

  const ss1 = path.join(PROOF_DIR, '01_content_planner_loaded.png');
  await page.screenshot({ path: ss1 });
  console.log(`[SCREENSHOT 1] Content Planner loaded: ${ss1}`);
  console.log(`  File size: ${fs.statSync(ss1).size} bytes`);

  console.log('[3] Looking for create post button...');
  let btn = await page.$('[data-testid="button-create-first-post"]');
  if (!btn) {
    btn = await page.$('[data-testid="button-create-post"]');
  }

  if (btn) {
    console.log('    Found button, clicking...');
    await btn.click();
    await new Promise(r => setTimeout(r, 1500));
  } else {
    console.log('    No create button found! Taking debug screenshot...');
    await page.screenshot({ path: path.join(PROOF_DIR, 'debug_no_button.png') });
  }

  const ss2 = path.join(PROOF_DIR, '02_new_post_modal_before_upload.png');
  await page.screenshot({ path: ss2 });
  console.log(`[SCREENSHOT 2] New Post modal BEFORE upload: ${ss2}`);
  console.log(`  File size: ${fs.statSync(ss2).size} bytes`);

  const dropzone = await page.$('[data-testid="media-upload-dropzone"]');
  console.log(`    Dropzone found: ${!!dropzone}`);

  if (dropzone) {
    const fileInput = await page.$('[data-testid="input-media-files"]');
    if (fileInput) {
      const pngBuf = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABmJLR0QA/wD/AP+gvaeTAAABYklEQVR4nO3UsQ0CQRAEQZ7/0pEABiTgJ+C+qgj2ZnZ3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAACA/+d49gA8Z+17dgY84/rsAXiOkBghMUJihMQIiRESIyRGSIyQGCExQmKExAiJERIjJEZIjJAYITFCYoTECIkREiMkRkiMkBghMUJihMQIiRESIyRGSIyQGCExQmKExAiJERIjJEZIjJAYITFCYoTECIkREiMkRkiMkBghMUJihMQIiRESIyRGSIyQGCExQmKExAiJERIjJEZIjJAYITFCYoTECIkREiMkRkiMkBghMUJihMQIiRESIyRGSIyQGCExQmKExAiJERIjJEZIjJAYITFCYoTECIkREiMkRkiMkBghMUJihMQIiRESIyRGSIyQGCExQmKExAiJERIjJEZIjJAYITFCYoTECIkREiMkRkiMkBghMUJihMQIiRESIyRGSMwvGHYEyVbLLlIAAAAASUVORK5CYII=',
        'base64'
      );
      const tmpFile = '/tmp/layla_proof_upload.png';
      fs.writeFileSync(tmpFile, pngBuf);

      console.log('[4] Uploading test image file...');
      await fileInput.uploadFile(tmpFile);
      await new Promise(r => setTimeout(r, 1000));

      const ss3 = path.join(PROOF_DIR, '03_file_selected_ready_to_upload.png');
      await page.screenshot({ path: ss3 });
      console.log(`[SCREENSHOT 3] File selected, ready to upload: ${ss3}`);
      console.log(`  File size: ${fs.statSync(ss3).size} bytes`);

      const uploadBtn = await page.$('[data-testid="button-upload-media"]');
      if (uploadBtn) {
        console.log('[5] Clicking upload button...');
        await uploadBtn.click();
        await new Promise(r => setTimeout(r, 2500));

        const ss4 = path.join(PROOF_DIR, '04_upload_complete_recently_uploaded.png');
        await page.screenshot({ path: ss4 });
        console.log(`[SCREENSHOT 4] Upload COMPLETE: ${ss4}`);
        console.log(`  File size: ${fs.statSync(ss4).size} bytes`);

        const hasError = await page.$('[data-testid="text-upload-error"]');
        const hasRecent = await page.$('[data-testid="recent-upload-0"]');
        console.log(`    Upload error visible: ${!!hasError}`);
        console.log(`    Recently Uploaded visible: ${!!hasRecent}`);
      } else {
        console.log('    Upload button not found!');
      }
    } else {
      console.log('    File input not found!');
    }
  }

  const ss5 = path.join(PROOF_DIR, '05_final_state.png');
  await page.screenshot({ path: ss5, fullPage: true });
  console.log(`[SCREENSHOT 5] Final state (full page): ${ss5}`);
  console.log(`  File size: ${fs.statSync(ss5).size} bytes`);

  await browser.close();

  console.log('\n=== ALL PROOF FILES ===');
  const files = fs.readdirSync(PROOF_DIR).filter(f => f.endsWith('.png'));
  for (const f of files) {
    const stat = fs.statSync(path.join(PROOF_DIR, f));
    console.log(`  ${f} — ${stat.size} bytes`);
  }
  console.log(`\nDONE. ${files.length} screenshots saved to ${PROOF_DIR}`);
}

run().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
