import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
const chromePath = execSync("find /home/alojzy/.cache/ms-playwright -name chrome -path '*chrome-linux*' -type f | head -1").toString().trim();
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
await page.goto('http://localhost:5173/materials', { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/claude-1000/-home-alojzy/e3a09858-c4e3-4ac5-bb02-772eb965511f/scratchpad/materials_wide.png', fullPage: true });
await browser.close();
