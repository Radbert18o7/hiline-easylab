const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Listen to all console events
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type().toUpperCase(), msg.text()));
    page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
    page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));
    
    console.log('Navigating to login to set auth...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.setItem('hl-auth', 'authenticated'));
    
    console.log('Navigating to dashboard...');
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle0', timeout: 30000 });
    
    console.log('Page loaded successfully without crashing the script.');
    
    // Wait a bit to ensure all React components mount
    await new Promise(r => setTimeout(r, 2000));
    
    await browser.close();
  } catch (err) {
    console.error('PUPPETEER SCRIPT ERROR:', err);
    process.exit(1);
  }
})();
