import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('in a narrow window the export destinations are labelled icons and the settings beside them stay on screen', { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-export-narrow-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Narrow');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'card.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#486b8e"/></svg>');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'assets/card.svg', time: [0, 4] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => { localStorage.setItem('openfilm.exportCenter.v1', JSON.stringify({ dest: 'video' })); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-id]').first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
    await dialog.waitFor({ state: 'visible' });
    const inside = async (locator, width) => {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      return Boolean(box && box.x >= 0 && box.x + box.width <= width);
    };
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 950 });
      const gif = dialog.getByRole('button', { name: 'GIF', exact: true });
      assert.equal(await gif.getAttribute('title'), 'GIF', 'a destination keeps its name when only its icon shows');
      assert.equal(await dialog.getByText('For docs, email, READMEs').isVisible(), width >= 640, `destination hints at ${width}px`);
      for (const name of ['HEVC', 'Export']) {
        assert.ok(await inside(dialog.getByRole('button', { name: new RegExp(`^${name}`) }).first(), width), `${name} stays on screen at ${width}px`);
      }
    }
    await dialog.getByRole('button', { name: 'GIF', exact: true }).click();
    assert.equal(await dialog.getByRole('button', { name: 'GIF', exact: true }).getAttribute('aria-pressed'), 'true');
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
