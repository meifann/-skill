import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const projectDir = path.resolve(process.argv[2] || process.cwd());
const serverUrl = process.argv[3] || 'http://127.0.0.1:8000';
const requireFromProject = createRequire(path.join(projectDir, 'package.json'));
const { chromium } = requireFromProject('playwright');

function requestStatus(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, response => {
            response.resume();
            resolve(response.statusCode || 0);
        });
        request.setTimeout(10_000, () => request.destroy(new Error('Request timed out')));
        request.on('error', reject);
    });
}

const homeStatus = await requestStatus(serverUrl);
if (homeStatus !== 200) {
    throw new Error(`Expected HTTP 200 from ${serverUrl}, received ${homeStatus}`);
}

const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(serverUrl, { waitUntil: 'networkidle', timeout: 30_000 });

    const title = await page.title();
    const bodyText = await page.locator('body').textContent() || '';
    const expectedTerms = ['Chat', 'Characters', 'API'];

    if (!title.includes('SillyTavern')) {
        throw new Error(`Unexpected page title: ${title}`);
    }
    if (!expectedTerms.some(term => bodyText.includes(term))) {
        throw new Error('Required SillyTavern page content was not found');
    }

    for (const resource of ['/style.css', '/manifest.json']) {
        const status = await requestStatus(new URL(resource, serverUrl).toString());
        if (status < 200 || status >= 300) {
            throw new Error(`${resource} returned HTTP ${status}`);
        }
    }

    const screenshotPath = '/tmp/sillytavern-playwright.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const screenshotSize = fs.statSync(screenshotPath).size;
    console.log(JSON.stringify({ title, homeStatus, screenshotPath, screenshotSize }));
} finally {
    await browser.close();
}
