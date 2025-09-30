import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { SitemapParser } from './src/sitemapParser.js';
import { WebCrawler } from './src/webCrawler.js';
import { MetaExtractor } from './src/metaExtractor.js';
import { Reporter } from './src/reporter.js';
import { AIService } from './src/aiService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3838;
const SITEMAPS_FILE = path.join(__dirname, 'saved-sitemaps.json');
const URL_REVIEWS_FILE = path.join(__dirname, 'url-reviews.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let activeAnalysis = null;

// Load saved sitemaps on startup
async function loadSavedSitemaps() {
  try {
    const data = await fs.readFile(SITEMAPS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Save sitemaps to file
async function saveSitemapsToFile(sitemaps) {
  try {
    await fs.writeFile(SITEMAPS_FILE, JSON.stringify(sitemaps, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving sitemaps:', error);
    return false;
  }
}

// Load URL reviews on startup
async function loadUrlReviews() {
  try {
    const data = await fs.readFile(URL_REVIEWS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

// Save URL reviews to file
async function saveUrlReviews(reviews) {
  try {
    await fs.writeFile(URL_REVIEWS_FILE, JSON.stringify(reviews, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving URL reviews:', error);
    return false;
  }
}

async function loadScanResults(sitemapUrl) {
  try {
    // Create a simple hash of the sitemap URL for the filename
    const hash = Buffer.from(sitemapUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
    const filename = `scan-results-${hash}.json`;
    const filePath = path.join(__dirname, 'data-v2', filename);

    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // No saved results found
    }
    throw error;
  }
}

async function saveScanResults(sitemapUrl, results) {
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, 'data-v2');
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }

    // Create a simple hash of the sitemap URL for the filename
    const hash = Buffer.from(sitemapUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
    const filename = `scan-results-${hash}.json`;
    const filePath = path.join(__dirname, 'data-v2', filename);

    // Add sitemapUrl to each result so we can identify which scan it belongs to
    const resultsWithSitemap = results.map(r => ({
      ...r,
      sitemapUrl: sitemapUrl
    }));

    await fs.writeFile(filePath, JSON.stringify(resultsWithSitemap, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving scan results:', error);
    return false;
  }
}

async function saveChangeHistory(sitemapUrl, changes) {
  try {
    const dataDir = path.join(__dirname, 'data-v2');
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }

    const hash = Buffer.from(sitemapUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
    const filename = `change-history-${hash}.json`;
    const filePath = path.join(__dirname, 'data-v2', filename);

    // Load existing history
    let history = [];
    try {
      const data = await fs.readFile(filePath, 'utf8');
      history = JSON.parse(data);
    } catch {
      // File doesn't exist yet, start with empty array
    }

    // Append new changes
    history.push(...changes);

    // Keep only last 1000 changes to prevent file from growing too large
    if (history.length > 1000) {
      history = history.slice(-1000);
    }

    await fs.writeFile(filePath, JSON.stringify(history, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving change history:', error);
    return false;
  }
}

async function loadChangeHistory(sitemapUrl) {
  try {
    const hash = Buffer.from(sitemapUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
    const filename = `change-history-${hash}.json`;
    const filePath = path.join(__dirname, 'data-v2', filename);

    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function generateQuickSummary(results) {
  const total = results.length;
  const withMetaDescription = results.filter(r => r.hasMetaDescription).length;
  const missingMetaDescription = total - withMetaDescription;
  const percentageWithMeta = total > 0 ? Math.round((withMetaDescription / total) * 100) : 0;

  const statusCounts = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});

  return {
    total,
    withMetaDescription,
    missingMetaDescription,
    percentageWithMeta,
    good: statusCounts.good || 0,
    warning: statusCounts.warning || 0,
    error: statusCounts.error || 0,
    errors: statusCounts.error || 0
  };
}

// Build URL tree structure
function buildUrlTree(results) {
  const tree = {
    name: '/',
    path: '/',
    children: {},
    urls: [],
    stats: { good: 0, warning: 0, error: 0, total: 0 }
  };

  results.forEach(result => {
    try {
      const url = new URL(result.url);
      const pathParts = url.pathname.split('/').filter(p => p);

      let currentLevel = tree;
      let currentPath = '';

      pathParts.forEach((part, index) => {
        currentPath += '/' + part;

        if (!currentLevel.children[part]) {
          currentLevel.children[part] = {
            name: part,
            path: currentPath,
            children: {},
            urls: [],
            stats: { good: 0, warning: 0, error: 0, total: 0 }
          };
        }

        currentLevel = currentLevel.children[part];

        // Add URL to the deepest level only
        if (index === pathParts.length - 1) {
          currentLevel.urls.push(result);
        }
      });

    } catch (error) {
      console.error('Error parsing URL:', result.url, error);
    }
  });

  // Second pass: recursively calculate stats from bottom up
  function calculateStats(node) {
    let stats = { good: 0, warning: 0, error: 0, total: 0 };

    // Add stats from direct URLs at this node
    node.urls.forEach(url => {
      const status = url.status;
      // Map old 'needs_attention' status to 'warning' for consistency
      if (status === 'needs_attention') {
        stats.warning++;
      } else if (stats.hasOwnProperty(status)) {
        stats[status]++;
      } else {
        // Unknown status, treat as warning
        stats.warning++;
      }
      stats.total++;
    });

    // Recursively add stats from child nodes
    Object.values(node.children).forEach(child => {
      const childStats = calculateStats(child);
      stats.good += childStats.good;
      stats.warning += childStats.warning;
      stats.error += childStats.error;
      stats.total += childStats.total;
    });

    node.stats = stats;
    return stats;
  }

  calculateStats(tree);

  return tree;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/analyze', async (req, res) => {
  const { sitemapUrl, options = {} } = req.body;

  if (!sitemapUrl) {
    return res.status(400).json({ error: 'Sitemap URL is required' });
  }

  if (activeAnalysis) {
    return res.status(429).json({ error: 'Analysis already in progress' });
  }

  const analysisId = Date.now().toString();
  activeAnalysis = analysisId;

  res.json({ analysisId, status: 'started' });

  try {
    const emit = (event, data) => io.emit(event, { analysisId, ...data });

    emit('progress', { step: 'parsing', message: 'Parsing sitemap...' });

    const sitemapParser = new SitemapParser();
    let urls = await sitemapParser.getAllUrls(sitemapUrl);

    // Load existing data
    const reviews = await loadUrlReviews();
    const existingResults = await loadScanResults(sitemapUrl);
    const scanMode = options.scanMode || 'full';

    // Create a Set of URLs that already exist in our database
    const existingUrls = new Set(existingResults.map(result => result.url));
    const totalUrlsFound = urls.length;

    // Filter URLs based on scan mode
    if (scanMode === 'incremental') {
      const newUrls = urls.filter(url => !existingUrls.has(url));

      emit('progress', {
        step: 'filtered',
        message: `Found ${totalUrlsFound} URLs in sitemap. ${existingUrls.size} already scanned, ${newUrls.length} new URLs to scan.`
      });

      if (newUrls.length === 0) {
        const mergedResults = existingResults.map(result => {
          const review = reviews[result.url];
          return {
            ...result,
            reviewStatus: review?.status || 'new',
            assignee: review?.assignee || null,
            notes: review?.notes || null,
            lastReviewed: review?.lastReviewed || null
          };
        });

        emit('complete', {
          results: {
            results: mergedResults,
            sitemap: { url: sitemapUrl },
            tree: buildUrlTree(mergedResults)
          },
          summary: generateQuickSummary(mergedResults)
        });
        return;
      }

      urls = newUrls;
    }

    const maxPages = parseInt(options.maxPages) || 100;
    if (urls.length > maxPages) {
      urls = urls.slice(0, maxPages);
    }

    emit('progress', {
      step: 'crawling',
      message: `Found ${urls.length} URLs. Starting crawl...`,
      total: urls.length
    });

    const crawler = new WebCrawler({
      delay: parseInt(options.delay) || 1000,
      timeout: parseInt(options.timeout) || 10000,
      usePuppeteer: options.enableMboDetection === 'true' || options.enableMboDetection === true
    });

    const chunkSize = parseInt(options.chunkSize) || 10;
    const chunks = [];
    for (let i = 0; i < urls.length; i += chunkSize) {
      chunks.push(urls.slice(i, i + chunkSize));
    }

    let allResults = [];
    let processedCount = 0;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];

      emit('progress', {
        step: 'crawling',
        message: `Processing chunk ${chunkIndex + 1} of ${chunks.length}...`,
        total: urls.length,
        current: processedCount
      });

      const chunkResults = await crawler.crawlUrls(chunk, (progress) => {
        emit('crawl-progress', {
          current: processedCount + progress.current,
          total: urls.length,
          percentage: Math.round(((processedCount + progress.current) / urls.length) * 100),
          url: progress.url
        });
      });

      allResults = allResults.concat(chunkResults);
      processedCount += chunk.length;

      if (chunkIndex < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    emit('progress', { step: 'analyzing', message: 'Analyzing meta descriptions...' });

    const metaExtractor = new MetaExtractor();
    const analysisResults = metaExtractor.processPages(allResults);

    const updatedReviews = { ...reviews };

    analysisResults.forEach(result => {
      const existingReview = updatedReviews[result.url] || {};
      updatedReviews[result.url] = {
        ...existingReview,
        seoStatus: result.status,
        hasIssues: result.issues && result.issues.length > 0,
        lastAnalyzed: new Date().toISOString()
      };
    });

    await saveUrlReviews(updatedReviews);

    const newResults = analysisResults.map(result => {
      const review = updatedReviews[result.url];
      return {
        ...result,
        reviewStatus: review?.status || 'new',
        assignee: review?.assignee || null,
        notes: review?.notes || null,
        lastReviewed: review?.lastReviewed || null
      };
    });

    let finalResults = newResults;
    if (scanMode === 'incremental' && existingResults.length > 0) {
      const existingWithReviews = existingResults.map(result => {
        const review = reviews[result.url];
        return {
          ...result,
          reviewStatus: review?.status || result.reviewStatus || 'new',
          assignee: review?.assignee || result.assignee || null,
          notes: review?.notes || result.notes || null,
          lastReviewed: review?.lastReviewed || result.lastReviewed || null
        };
      });

      const allUrls = new Set();
      finalResults = [];

      existingWithReviews.forEach(result => {
        allUrls.add(result.url);
        finalResults.push(result);
      });

      newResults.forEach(result => {
        if (allUrls.has(result.url)) {
          const index = finalResults.findIndex(r => r.url === result.url);
          finalResults[index] = result;
        } else {
          finalResults.push(result);
        }
      });
    }

    const reporter = new Reporter();
    reporter.setResults(finalResults);
    const jsonReport = reporter.generateJsonReport();

    const crawlTimestamp = new Date().toISOString();

    // Detect changes from previous scan
    const changesDetected = [];
    const timestampedResults = finalResults.map(result => {
      const oldResult = existingResults.find(r => r.url === result.url);
      let hasChanged = false;
      let changeType = null;

      if (oldResult) {
        // Check if meta description changed
        if (oldResult.metaDescription !== result.metaDescription) {
          hasChanged = true;
          changeType = 'modified';
          changesDetected.push({
            url: result.url,
            changeType: 'meta_description',
            oldValue: oldResult.metaDescription,
            newValue: result.metaDescription,
            timestamp: crawlTimestamp
          });
        }
        // Check if title changed
        if (oldResult.title !== result.title) {
          hasChanged = true;
          changesDetected.push({
            url: result.url,
            changeType: 'title',
            oldValue: oldResult.title,
            newValue: result.title,
            timestamp: crawlTimestamp
          });
        }
      } else {
        // New URL detected
        hasChanged = true;
        changeType = 'new';
        changesDetected.push({
          url: result.url,
          changeType: 'new_url',
          newValue: result.metaDescription,
          timestamp: crawlTimestamp
        });
      }

      return {
        ...result,
        lastCrawled: crawlTimestamp,
        hasChanged,
        changeType
      };
    });

    // Save change history if there are changes
    if (changesDetected.length > 0) {
      await saveChangeHistory(sitemapUrl, changesDetected);
    }

    await saveScanResults(sitemapUrl, timestampedResults);

    emit('complete', {
      results: {
        ...jsonReport,
        results: finalResults,
        tree: buildUrlTree(finalResults)
      },
      summary: reporter.generateSummary()
    });

  } catch (error) {
    io.emit('error', {
      analysisId,
      error: error.message,
      details: error.stack
    });
  } finally {
    activeAnalysis = null;
  }
});

// Selective scan endpoint - scan only selected URLs
app.post('/api/selective-scan', async (req, res) => {
  const { urls, sitemapUrl, options = {} } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URLs array is required' });
  }

  if (!sitemapUrl) {
    return res.status(400).json({ error: 'Sitemap URL is required for saving results' });
  }

  if (activeAnalysis) {
    return res.status(429).json({ error: 'Analysis already in progress' });
  }

  const analysisId = Date.now().toString();
  activeAnalysis = analysisId;

  res.json({ analysisId, status: 'started' });

  try {
    const emit = (event, data) => io.emit(event, { analysisId, ...data });

    emit('progress', {
      step: 'starting',
      message: `Starting selective scan of ${urls.length} URLs...`
    });

    const crawler = new WebCrawler({
      delay: parseInt(options.delay) || 1000,
      timeout: parseInt(options.timeout) || 10000,
      usePuppeteer: options.enableMboDetection === 'true' || options.enableMboDetection === true
    });

    // Crawl the selected URLs
    const crawlResults = await crawler.crawlUrls(urls, (progress) => {
      emit('crawl-progress', {
        current: progress.current,
        total: urls.length,
        percentage: Math.round((progress.current / urls.length) * 100),
        url: progress.url
      });
    });

    emit('progress', { step: 'analyzing', message: 'Analyzing meta descriptions...' });

    const metaExtractor = new MetaExtractor();
    const analysisResults = metaExtractor.processPages(crawlResults);

    // Load existing scan results and reviews
    const existingResults = await loadScanResults(sitemapUrl);
    const reviews = await loadUrlReviews();

    // Update reviews with new scan data
    const updatedReviews = { ...reviews };
    analysisResults.forEach(result => {
      const existingReview = updatedReviews[result.url] || {};
      updatedReviews[result.url] = {
        ...existingReview,
        seoStatus: result.status,
        hasIssues: result.issues && result.issues.length > 0,
        lastAnalyzed: new Date().toISOString()
      };
    });

    await saveUrlReviews(updatedReviews);

    // Merge with existing results
    const existingUrlsMap = {};
    existingResults.forEach(result => {
      existingUrlsMap[result.url] = result;
    });

    // Add timestamp and merge
    const crawlTimestamp = new Date().toISOString();
    const timestampedResults = analysisResults.map(result => {
      const oldResult = existingUrlsMap[result.url];
      const review = updatedReviews[result.url];

      return {
        ...result,
        lastCrawled: crawlTimestamp,
        reviewStatus: review?.status || 'new',
        assignee: review?.assignee || null,
        notes: review?.notes || null,
        lastReviewed: review?.lastReviewed || null,
        hasChanged: oldResult && oldResult.metaDescription !== result.metaDescription,
        changeType: oldResult ? (oldResult.metaDescription !== result.metaDescription ? 'modified' : null) : 'new'
      };
    });

    // Update existing results with new scans
    const finalResults = [...existingResults];
    timestampedResults.forEach(newResult => {
      const index = finalResults.findIndex(r => r.url === newResult.url);
      if (index !== -1) {
        finalResults[index] = newResult;
      } else {
        finalResults.push(newResult);
      }
    });

    // Save updated results
    await saveScanResults(sitemapUrl, finalResults);

    emit('complete', {
      results: {
        results: finalResults,
        scanType: 'selective',
        scannedUrls: urls.length,
        tree: buildUrlTree(finalResults)
      },
      summary: generateQuickSummary(finalResults)
    });

  } catch (error) {
    io.emit('error', {
      analysisId,
      error: error.message,
      details: error.stack
    });
  } finally {
    activeAnalysis = null;
  }
});

// NEW V2 ENDPOINT: Detect duplicate meta descriptions
app.post('/api/detect-duplicates', async (req, res) => {
  const { sitemapUrl } = req.body;

  if (!sitemapUrl) {
    return res.status(400).json({ error: 'Sitemap URL is required' });
  }

  try {
    const results = await loadScanResults(sitemapUrl);

    if (results.length === 0) {
      return res.json({ duplicates: [], total: 0 });
    }

    const metaDescriptionMap = {};

    results.forEach(result => {
      if (result.metaDescription && result.metaDescription.trim()) {
        const meta = result.metaDescription.trim().toLowerCase();
        if (!metaDescriptionMap[meta]) {
          metaDescriptionMap[meta] = [];
        }
        metaDescriptionMap[meta].push({
          url: result.url,
          metaDescription: result.metaDescription,
          status: result.status
        });
      }
    });

    // Filter only duplicates (more than 1 URL with same meta description)
    const duplicates = Object.entries(metaDescriptionMap)
      .filter(([_, urls]) => urls.length > 1)
      .map(([meta, urls]) => ({
        metaDescription: urls[0].metaDescription,
        count: urls.length,
        urls: urls
      }))
      .sort((a, b) => b.count - a.count);

    res.json({
      duplicates,
      total: duplicates.length,
      affectedUrls: duplicates.reduce((sum, dup) => sum + dup.count, 0)
    });

  } catch (error) {
    console.error('Error detecting duplicates:', error);
    res.status(500).json({ error: 'Failed to detect duplicates' });
  }
});

// All other endpoints from V1 (continuing with the same logic)
app.get('/api/export/:format', (req, res) => {
  const { format } = req.params;
  const { results } = req.query;

  if (!results) {
    return res.status(400).json({ error: 'Results data is required' });
  }

  try {
    const parsedResults = JSON.parse(decodeURIComponent(results));
    const reporter = new Reporter();
    reporter.setResults(parsedResults.results);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `seo-report-${timestamp}.${format}`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    switch (format.toLowerCase()) {
      case 'json':
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(reporter.generateJsonReport(), null, 2));
        break;
      case 'csv':
        res.setHeader('Content-Type', 'text/csv');
        res.send(reporter.generateCsvReport());
        break;
      default:
        return res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate export' });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    active: !!activeAnalysis,
    analysisId: activeAnalysis
  });
});

app.get('/api/sitemaps', async (req, res) => {
  try {
    const sitemaps = await loadSavedSitemaps();
    res.json(sitemaps);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sitemaps' });
  }
});

app.post('/api/sitemaps', async (req, res) => {
  const { name, url } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  try {
    const sitemaps = await loadSavedSitemaps();
    const newSitemap = {
      id: Date.now().toString(),
      name: name.trim(),
      url: url.trim(),
      createdAt: new Date().toISOString()
    };

    sitemaps.push(newSitemap);
    const success = await saveSitemapsToFile(sitemaps);

    if (success) {
      res.json(newSitemap);
    } else {
      res.status(500).json({ error: 'Failed to save sitemap' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to save sitemap' });
  }
});

app.delete('/api/sitemaps/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const sitemaps = await loadSavedSitemaps();
    const filteredSitemaps = sitemaps.filter(sitemap => sitemap.id !== id);

    if (filteredSitemaps.length === sitemaps.length) {
      return res.status(404).json({ error: 'Sitemap not found' });
    }

    const success = await saveSitemapsToFile(filteredSitemaps);

    if (success) {
      res.json({ message: 'Sitemap deleted successfully' });
    } else {
      res.status(500).json({ error: 'Failed to delete sitemap' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete sitemap' });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const reviews = await loadUrlReviews();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load URL reviews' });
  }
});

app.get('/api/change-history', async (req, res) => {
  const { sitemapUrl, url } = req.query;

  if (!sitemapUrl) {
    return res.status(400).json({ error: 'Sitemap URL is required' });
  }

  try {
    let history = await loadChangeHistory(sitemapUrl);

    // Filter by specific URL if provided
    if (url) {
      history = history.filter(change => change.url === url);
    }

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load change history' });
  }
});

app.get('/api/saved-scans', async (req, res) => {
  try {
    const dataDir = path.join(__dirname, 'data-v2');

    // Check if data directory exists
    try {
      await fs.access(dataDir);
    } catch {
      return res.json({ scans: [] });
    }

    // Read all files in data directory
    const files = await fs.readdir(dataDir);
    const scanFiles = files.filter(f => f.startsWith('scan-results-') && f.endsWith('.json'));

    // Read metadata from each scan file
    const scans = await Promise.all(scanFiles.map(async (file) => {
      try {
        const filePath = path.join(dataDir, file);
        const data = await fs.readFile(filePath, 'utf8');
        const results = JSON.parse(data);

        // Extract sitemap URL from first result if available
        const sitemapUrl = results.length > 0 && results[0].sitemapUrl ? results[0].sitemapUrl : null;

        // Get file stats for timestamp
        const stats = await fs.stat(filePath);

        return {
          id: file.replace('scan-results-', '').replace('.json', ''),
          sitemapUrl,
          filename: file,
          totalUrls: results.length,
          lastScanned: stats.mtime,
          goodCount: results.filter(r => r.status === 'good').length,
          warningCount: results.filter(r => r.status === 'warning').length,
          errorCount: results.filter(r => r.status === 'error').length
        };
      } catch (error) {
        console.error(`Error reading scan file ${file}:`, error);
        return null;
      }
    }));

    // Filter out nulls and sort by last scanned
    const validScans = scans.filter(s => s !== null).sort((a, b) =>
      new Date(b.lastScanned) - new Date(a.lastScanned)
    );

    res.json({ scans: validScans });
  } catch (error) {
    console.error('Error listing saved scans:', error);
    res.status(500).json({ error: 'Failed to list saved scans' });
  }
});

app.get('/api/scan-results', async (req, res) => {
  const { sitemapUrl } = req.query;

  if (!sitemapUrl) {
    return res.status(400).json({ error: 'Sitemap URL is required' });
  }

  try {
    const results = await loadScanResults(sitemapUrl);
    const reviews = await loadUrlReviews();

    const mergedResults = results.map(result => {
      const review = reviews[result.url];
      return {
        ...result,
        reviewStatus: review?.status || 'new',
        assignee: review?.assignee || null,
        notes: review?.notes || null,
        lastReviewed: review?.lastReviewed || null
      };
    });

    res.json({
      results: mergedResults,
      tree: buildUrlTree(mergedResults)
    });
  } catch (error) {
    console.error('Error loading scan results:', error);
    res.status(500).json({ error: 'Failed to load scan results' });
  }
});

app.post('/api/scan-results/update', async (req, res) => {
  const { sitemapUrl, url, title, metaDescription } = req.body;

  if (!sitemapUrl || !url) {
    return res.status(400).json({ error: 'Sitemap URL and URL are required' });
  }

  try {
    // Load existing results
    const results = await loadScanResults(sitemapUrl);

    // Find and update the specific URL
    const index = results.findIndex(r => r.url === url);
    if (index === -1) {
      return res.status(404).json({ error: 'URL not found in scan results' });
    }

    // Update the result
    results[index].title = title;
    results[index].metaDescription = metaDescription;
    results[index].characterCount = metaDescription ? metaDescription.length : 0;

    // Recalculate status
    const charCount = results[index].characterCount;
    if (!metaDescription || charCount === 0) {
      results[index].status = 'error';
      results[index].issues = ['Missing meta description'];
    } else if (charCount >= 120 && charCount <= 160) {
      results[index].status = 'good';
      results[index].issues = [];
    } else if (charCount < 120) {
      results[index].status = 'warning';
      results[index].issues = ['Meta description too short (aim for 120-160 characters)'];
    } else {
      results[index].status = 'warning';
      results[index].issues = ['Meta description too long (aim for 120-160 characters)'];
    }

    results[index].lastModified = new Date().toISOString();

    // Save back to file
    await saveScanResults(sitemapUrl, results);

    res.json({
      success: true,
      message: 'URL updated successfully',
      result: results[index]
    });
  } catch (error) {
    console.error('Error updating scan results:', error);
    res.status(500).json({ error: 'Failed to update scan results' });
  }
});

app.post('/api/sitemap/all-urls', async (req, res) => {
  const { sitemapUrl } = req.body;

  if (!sitemapUrl) {
    return res.status(400).json({ error: 'Sitemap URL is required' });
  }

  try {
    const sitemapParser = new SitemapParser();
    const allUrls = await sitemapParser.getAllUrls(sitemapUrl);
    const reviews = await loadUrlReviews();

    // Load scan results to determine which URLs have been scanned
    let scanResults = [];
    try {
      scanResults = await loadScanResults(sitemapUrl);
    } catch (error) {
      // No scan results available yet - that's okay
    }

    // Create a lookup map for scan results
    const scanResultsMap = {};
    scanResults.forEach(result => {
      scanResultsMap[result.url] = result;
    });

    // Map all URLs with their scan status
    const urlsWithStatus = allUrls.map(url => {
      const scanResult = scanResultsMap[url];
      const review = reviews[url];

      return {
        url,
        isScanned: !!scanResult,
        scanData: scanResult || null,
        reviewStatus: review?.status || 'new',
        assignee: review?.assignee || null,
        notes: review?.notes || null,
        lastScanned: scanResult?.lastAnalyzed || null,
        lastReviewed: review?.lastReviewed || null,
        seoStatus: scanResult?.status || null
      };
    });

    const scannedCount = urlsWithStatus.filter(u => u.isScanned).length;
    const unscannedCount = urlsWithStatus.length - scannedCount;

    res.json({
      urls: urlsWithStatus,
      total: urlsWithStatus.length,
      scanned: scannedCount,
      unscanned: unscannedCount
    });
  } catch (error) {
    console.error('Error fetching sitemap URLs:', error);
    res.status(500).json({ error: 'Failed to fetch sitemap URLs' });
  }
});

app.post('/api/reviews/update', async (req, res) => {
  const { url, status, assignee, notes } = req.body;

  if (!url || !status) {
    return res.status(400).json({ error: 'URL and status are required' });
  }

  try {
    const reviews = await loadUrlReviews();

    reviews[url] = {
      status: status.trim(),
      assignee: assignee ? assignee.trim() : null,
      notes: notes ? notes.trim() : null,
      lastReviewed: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    const success = await saveUrlReviews(reviews);

    if (success) {
      res.json({ message: 'URL review updated successfully', review: reviews[url] });
    } else {
      res.status(500).json({ error: 'Failed to save URL review' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update URL review' });
  }
});

app.post('/api/reviews/bulk-update', async (req, res) => {
  const { urls, status, assignee } = req.body;

  if (!urls || !Array.isArray(urls) || !status) {
    return res.status(400).json({ error: 'URLs array and status are required' });
  }

  try {
    const reviews = await loadUrlReviews();
    const timestamp = new Date().toISOString();

    urls.forEach(url => {
      reviews[url] = {
        ...reviews[url],
        status: status.trim(),
        assignee: assignee ? assignee.trim() : reviews[url]?.assignee || null,
        lastReviewed: timestamp,
        lastUpdated: timestamp
      };
    });

    const success = await saveUrlReviews(reviews);

    if (success) {
      res.json({ message: `${urls.length} URLs updated successfully` });
    } else {
      res.status(500).json({ error: 'Failed to save URL reviews' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk update URL reviews' });
  }
});

app.post('/api/rescan-url', async (req, res) => {
  const { url, sitemapUrl } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const webCrawler = new WebCrawler({ usePuppeteer: true });

    const crawlResult = await webCrawler.fetchPageWithPuppeteer(url);

    if (!crawlResult.success) {
      return res.status(400).json({
        error: `Failed to crawl URL: ${crawlResult.error}`,
        url: url
      });
    }

    const metaExtractor = new MetaExtractor();
    const analysisResult = metaExtractor.extractMetaData(crawlResult.html, url);

    analysisResult.dataLayer = crawlResult.dataLayer || { objectId: null, hasDataLayer: false };

    const reviews = await loadUrlReviews();
    const existingReview = reviews[url] || {};

    reviews[url] = {
      ...existingReview,
      seoStatus: analysisResult.status,
      hasIssues: analysisResult.issues && analysisResult.issues.length > 0,
      lastAnalyzed: new Date().toISOString()
    };

    await saveUrlReviews(reviews);

    const changes = [];
    let oldResult = null;

    if (sitemapUrl) {
      try {
        const existingScanResults = await loadScanResults(sitemapUrl);
        oldResult = existingScanResults.find(result => result.url === url);

        // Detect changes
        if (oldResult) {
          if (oldResult.metaDescription !== analysisResult.metaDescription) {
            changes.push({
              url: url,
              changeType: 'meta_description',
              oldValue: oldResult.metaDescription,
              newValue: analysisResult.metaDescription,
              timestamp: new Date().toISOString()
            });
          }
          if (oldResult.title !== analysisResult.title) {
            changes.push({
              url: url,
              changeType: 'title',
              oldValue: oldResult.title,
              newValue: analysisResult.title,
              timestamp: new Date().toISOString()
            });
          }
        }

        const updatedScanResults = existingScanResults.map(result => {
          if (result.url === url) {
            return {
              ...analysisResult,
              reviewStatus: existingReview.status || 'new',
              assignee: existingReview.assignee || null,
              notes: existingReview.notes || null,
              lastReviewed: existingReview.lastReviewed || null,
              lastCrawled: new Date().toISOString(),
              hasChanged: changes.length > 0,
              changeType: changes.length > 0 ? 'modified' : undefined
            };
          }
          return result;
        });

        if (!existingScanResults.find(result => result.url === url)) {
          updatedScanResults.push({
            ...analysisResult,
            reviewStatus: existingReview.status || 'new',
            assignee: existingReview.assignee || null,
            notes: existingReview.notes || null,
            lastReviewed: existingReview.lastReviewed || null,
            lastCrawled: new Date().toISOString()
          });
        }

        // Save changes if any
        if (changes.length > 0) {
          await saveChangeHistory(sitemapUrl, changes);
        }

        await saveScanResults(sitemapUrl, updatedScanResults);
      } catch (error) {
        console.error('Error updating scan results database:', error);
      }
    }

    const result = {
      ...analysisResult,
      reviewStatus: existingReview.status || 'new',
      assignee: existingReview.assignee || null,
      notes: existingReview.notes || null,
      lastReviewed: existingReview.lastReviewed || null,
      lastAnalyzed: new Date().toISOString(),
      hasChanged: changes.length > 0,
      changeType: changes.length > 0 ? 'modified' : undefined
    };

    res.json({
      success: true,
      result: result,
      hasChanges: changes.length > 0
    });
  } catch (error) {
    console.error('Error rescanning URL:', error);
    res.status(500).json({ error: 'Failed to rescan URL' });
  }
});

// Initialize AI Service
const aiService = new AIService();

// AI Endpoints

// Test AI connection
app.get('/api/ai/test', async (req, res) => {
  try {
    const result = await aiService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Detect MBO session
app.post('/api/detect-mbo', async (req, res) => {
  const { baseUrl } = req.body;

  if (!baseUrl) {
    return res.status(400).json({ error: 'Base URL is required' });
  }

  try {
    console.log('🔍 Attempting to detect MBO session for:', baseUrl);

    const webCrawler = new WebCrawler({ usePuppeteer: true });
    const mboSession = await webCrawler.detectMboSession(baseUrl);

    console.log('MBO detection result:', mboSession);

    res.json(mboSession);
  } catch (error) {
    console.error('❌ Error detecting MBO session:', error);
    res.status(500).json({
      hasSession: false,
      sessionType: null,
      token: null,
      error: error.message
    });
  }
});

// Build AI prompt (preview before sending)
app.post('/api/ai/build-prompt', async (req, res) => {
  const { url, title, currentMeta } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    console.log(`Building AI prompt for: ${url}`);

    const result = await aiService.buildPromptWithContext({
      url,
      title: title || '',
      currentMeta: currentMeta || ''
    });

    res.json(result);
  } catch (error) {
    console.error('Prompt Building Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to build prompt: ' + error.message
    });
  }
});

// Generate AI meta description suggestions with custom prompt
app.post('/api/ai/generate-meta', async (req, res) => {
  const { prompt, count } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    console.log(`Generating AI suggestions with custom prompt`);

    const result = await aiService.generateFromPrompt(prompt, count || 5);

    res.json(result);
  } catch (error) {
    console.error('AI Generation Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate suggestions: ' + error.message
    });
  }
});

// Bulk generate AI meta descriptions
app.post('/api/ai/bulk-generate', async (req, res) => {
  const { pages, suggestionsPerPage } = req.body;

  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'Pages array is required' });
  }

  try {
    const result = await aiService.generateBulkMetaDescriptions(
      pages,
      suggestionsPerPage || 3
    );

    res.json(result);
  } catch (error) {
    console.error('Bulk AI Generation Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate bulk suggestions: ' + error.message
    });
  }
});

// Analyze meta description quality
app.post('/api/ai/analyze-meta', async (req, res) => {
  const { metaDescription } = req.body;

  if (!metaDescription) {
    return res.status(400).json({ error: 'Meta description is required' });
  }

  try {
    const result = await aiService.analyzeMetaDescription(metaDescription);
    res.json(result);
  } catch (error) {
    console.error('AI Analysis Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze meta description: ' + error.message
    });
  }
});

// Extract keywords from meta description
app.post('/api/ai/extract-keywords', async (req, res) => {
  const { metaDescription } = req.body;

  if (!metaDescription) {
    return res.status(400).json({ error: 'Meta description is required' });
  }

  try {
    const result = await aiService.extractKeywords(metaDescription);
    res.json(result);
  } catch (error) {
    console.error('Keyword Extraction Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extract keywords: ' + error.message
    });
  }
});

io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SEO Checker V2 running on:`);
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   Network: http://0.0.0.0:${PORT}`);
  console.log(`\n📱 Access from any device on your local network!`);
  console.log(`\n🤖 Claude AI: ${process.env.ANTHROPIC_API_KEY ? 'Enabled ✅' : 'Disabled ❌'}`);
});