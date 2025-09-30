import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-core';
import fs from 'fs';

export class WebCrawler {
  constructor(options = {}) {
    this.delayMs = options.delay || 1000;
    this.timeout = options.timeout || 10000;
    this.userAgent = options.userAgent || 'SEO-Checker-Bot/1.0';
    this.usePuppeteer = options.usePuppeteer || false;
    this.browser = null;
    this.mboSessionToken = null;
    this.mboShopId = 'yxve46fvrnud'; // Could be made configurable
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  findChromeExecutable() {
    const possiblePaths = [
      // macOS
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      // Windows
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      // Linux
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    ];

    for (const path of possiblePaths) {
      try {
        if (fs.existsSync(path)) {
          return path;
        }
      } catch (error) {
        // Continue to next path
      }
    }

    return null;
  }

  async initializePuppeteer() {
    if (!this.browser) {
      const executablePath = this.findChromeExecutable();

      if (!executablePath) {
        throw new Error(
          'Chrome/Chromium not found. Please install Google Chrome or Chromium browser.\n' +
          'Alternative: Install full puppeteer package with: npm install puppeteer'
        );
      }


      this.browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });
    }
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async detectMboSession(baseUrl) {
    try {
      await this.initializePuppeteer();
      const page = await this.browser.newPage();

      const adminUrl = `${baseUrl}/epages/${this.mboShopId}.admin`;
      const storefrontUrl = `${baseUrl}/epages/${this.mboShopId}.sf`;

      // Try admin MBO session first
      try {
        await page.goto(adminUrl, { waitUntil: 'networkidle2', timeout: 8000 });

        // Check if we're authenticated (not on login page)
        const sessionInfo = await page.evaluate(() => {
          const isLogin = window.location.href.includes('login') ||
                         document.querySelector('input[name="password"]') ||
                         document.querySelector('form[action*="login"]');

          const isAuthenticated = !isLogin &&
                                (window.location.href.includes('.admin') ||
                                 window.location.href.includes('mbo') ||
                                 document.querySelector('[data-testid="mbo"]') ||
                                 document.querySelector('.mbo-header') ||
                                 document.title.toLowerCase().includes('mbo'));

          return {
            isAuthenticated,
            currentUrl: window.location.href,
            title: document.title,
            hasPasswordField: !!document.querySelector('input[name="password"]')
          };
        });


        if (sessionInfo.isAuthenticated) {
          // Try multiple methods to find the security token
          let token = null;

          // Method 1: Extract from URL parameters
          const secMatch = sessionInfo.currentUrl.match(/[?&]sec=([^&]+)/);
          if (secMatch) {
            token = secMatch[1];
          }

          // Method 2: Look for token in page content or localStorage
          if (!token) {
            token = await page.evaluate(() => {
              // Check localStorage
              try {
                const storedToken = localStorage.getItem('mbo_token') ||
                                  localStorage.getItem('security_token') ||
                                  localStorage.getItem('sec');
                if (storedToken) return storedToken;
              } catch (e) {}

              // Check for token in page content
              try {
                const bodyText = document.body.innerText;
                const tokenMatch = bodyText.match(/sec[=:]\s*([a-zA-Z0-9]{20,})/);
                if (tokenMatch) return tokenMatch[1];
              } catch (e) {}

              // Check for token in any form inputs
              try {
                const secInput = document.querySelector('input[name*="sec"], input[id*="sec"]');
                if (secInput && secInput.value) return secInput.value;
              } catch (e) {}

              return null;
            });
          }

          // Method 3: Navigate to a typical MBO page to get the token
          if (!token) {
            try {
              await page.goto(`${baseUrl}/epages/${this.mboShopId}.admin/`, { waitUntil: 'networkidle2', timeout: 5000 });
              const dashboardUrl = page.url();
              const dashboardSecMatch = dashboardUrl.match(/[?&]sec=([^&]+)/);
              if (dashboardSecMatch) {
                token = dashboardSecMatch[1];
              }
            } catch (e) {
            }
          }

          if (token) {
            this.mboSessionToken = token;
            await page.close();
            return {
              hasSession: true,
              sessionType: 'admin',
              token: this.mboSessionToken,
              url: adminUrl,
              detectedAt: new Date().toISOString()
            };
          } else {
          }
        } else {
        }
      } catch (error) {
      }

      // Try storefront session as fallback (won't have sec token but confirms ePages)
      try {
        await page.goto(storefrontUrl, { waitUntil: 'networkidle2', timeout: 5000 });
        const isStorefront = await page.evaluate(() => {
          return window.location.href.includes('.sf') &&
                 !window.location.href.includes('login') &&
                 (window.ewindow?.epConfig || document.querySelector('[data-epages]'));
        });

        if (isStorefront) {
          await page.close();
          return {
            hasSession: true,
            sessionType: 'storefront',
            token: null,
            url: storefrontUrl,
            detectedAt: new Date().toISOString()
          };
        }
      } catch (error) {
      }

      await page.close();
      return { hasSession: false, sessionType: null, token: null, url: null };

    } catch (error) {
      console.error('❌ Error detecting MBO session:', error);
      return { hasSession: false, sessionType: null, token: null, url: null };
    }
  }

  async fetchPageWithPuppeteer(url) {
    try {
      await this.initializePuppeteer();
      const page = await this.browser.newPage();

      await page.setUserAgent(this.userAgent);
      const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: this.timeout });

      // Wait for ePages data layer to load (try multiple times)
      let dataLayerInfo = null;

      for (let attempt = 1; attempt <= 5; attempt++) {

        dataLayerInfo = await page.evaluate(() => {
          // Debug: Log what's available
          const hasEpConfig = !!window.epConfig;

          if (hasEpConfig) {
          }

          return hasEpConfig;
        });

        if (dataLayerInfo) {
          break;
        }

        // Wait 2 seconds before next attempt
        await page.waitForTimeout(2000);
      }

      // Now extract the actual data
      dataLayerInfo = await page.evaluate(() => {
        try {
          // Debug: Log what's available

          let objectId = null;
          let hasDataLayer = false;
          let debugInfo = {};

          // Check for window.epConfig (correct path)
          if (window.epConfig) {
            hasDataLayer = true;
            objectId = window.epConfig.objectId || null;
            debugInfo.foundEpConfig = true;
            debugInfo.objectId = objectId;
            debugInfo.epConfigKeys = Object.keys(window.epConfig || {});
            debugInfo.fullEpConfig = window.epConfig; // Include full config for debugging
          } else {
            // Fallback: look for the data in script tags or other locations
            debugInfo.foundEpConfig = false;
            debugInfo.windowKeys = Object.keys(window);

            // Check if there's a script tag with the data
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
              if (script.innerHTML.includes('objectId') && script.innerHTML.includes('epConfig')) {
                debugInfo.foundInScript = true;
                break;
              }
            }
          }

          return {
            objectId,
            hasDataLayer,
            debugInfo
          };
        } catch (error) {
          return {
            objectId: null,
            hasDataLayer: false,
            error: error.message,
            debugInfo: { error: error.message }
          };
        }
      });

      const html = await page.content();

      await page.close();

      return {
        url,
        html,
        status: response ? response.status() : 200,
        contentType: response ? response.headers()['content-type'] : 'text/html',
        success: true,
        dataLayer: dataLayerInfo
      };
    } catch (error) {
      return {
        url,
        html: null,
        status: null,
        error: error.message,
        success: false,
        dataLayer: { objectId: null, hasDataLayer: false }
      };
    }
  }

  async fetchPage(url) {
    if (this.usePuppeteer) {
      return await this.fetchPageWithPuppeteer(url);
    }

    // Fallback to axios for basic HTML fetching
    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        }
      });

      return {
        url,
        html: response.data,
        status: response.status,
        contentType: response.headers['content-type'],
        success: true,
        dataLayer: { objectId: null, hasDataLayer: false }
      };
    } catch (error) {
      return {
        url,
        html: null,
        status: error.response?.status || null,
        error: error.message,
        success: false,
        dataLayer: { objectId: null, hasDataLayer: false }
      };
    }
  }

  generateMboUrl(objectId, baseUrl) {
    if (!objectId || !this.mboSessionToken) {
      return null;
    }

    return `${baseUrl}/epages/${this.mboShopId}.admin/sec${this.mboSessionToken}/?ObjectID=${objectId}`;
  }

  async crawlUrls(urls, onProgress = null) {
    const results = [];

    try {
      // Detect MBO session if using Puppeteer
      if (this.usePuppeteer && urls.length > 0) {
        const firstUrl = new URL(urls[0]);
        const baseUrl = `${firstUrl.protocol}//${firstUrl.hostname}`;
        const mboSession = await this.detectMboSession(baseUrl);

        if (mboSession.hasSession) {
        }
      }

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: urls.length,
            url,
            percentage: Math.round(((i + 1) / urls.length) * 100)
          });
        }

        const result = await this.fetchPage(url);

        // Add MBO URL if we have objectID and token
        if (result.success && result.dataLayer?.objectId && this.mboSessionToken) {
          const baseUrl = new URL(url);
          result.mboUrl = this.generateMboUrl(result.dataLayer.objectId, `${baseUrl.protocol}//${baseUrl.hostname}`);
        }

        results.push(result);

        if (i < urls.length - 1) {
          await this.delay(this.delayMs);
        }
      }

      return results;

    } finally {
      // Ensure browser is closed
      if (this.usePuppeteer && this.browser) {
        await this.closeBrowser();
      }
    }
  }
}