import * as cheerio from 'cheerio';

export class MetaExtractor {
  extractMetaData(html, url) {
    if (!html) {
      return {
        url,
        title: null,
        metaDescription: null,
        hasMetaDescription: false,
        characterCount: 0,
        status: 'error',
        issues: ['Failed to fetch page content']
      };
    }

    const $ = cheerio.load(html);

    const title = $('title').text().trim() || null;
    const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null;

    const characterCount = metaDescription ? metaDescription.length : 0;
    const hasMetaDescription = !!metaDescription;

    const issues = this.analyzeIssues(metaDescription, title);
    const technicalSeo = this.analyzeTechnicalSeo($);
    const status = issues.length > 0 ? 'needs_attention' : 'good';

    return {
      url,
      title,
      metaDescription,
      hasMetaDescription,
      characterCount,
      status,
      issues,
      technicalSeo
    };
  }

  analyzeIssues(metaDescription, title) {
    const issues = [];

    if (!metaDescription) {
      issues.push('Missing meta description');
      return issues;
    }

    const length = metaDescription.length;

    if (length < 120) {
      issues.push(`Meta description too short (${length} chars) - recommended 120-160 characters`);
    } else if (length > 160) {
      issues.push(`Meta description too long (${length} chars) - recommended 120-160 characters`);
    }

    if (title && metaDescription.toLowerCase() === title.toLowerCase()) {
      issues.push('Meta description is identical to title');
    }

    if (metaDescription.toLowerCase().includes('lorem ipsum')) {
      issues.push('Contains placeholder text (Lorem ipsum)');
    }

    const duplicateWords = this.findDuplicateWords(metaDescription);
    if (duplicateWords.length > 0) {
      issues.push(`Contains repeated words: ${duplicateWords.join(', ')}`);
    }

    if (!/[.!?]$/.test(metaDescription)) {
      issues.push('Meta description should end with punctuation');
    }

    return issues;
  }

  findDuplicateWords(text) {
    const words = text.toLowerCase().split(/\s+/).filter(word => word.length > 3);
    const wordCount = {};
    const duplicates = [];

    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });

    Object.keys(wordCount).forEach(word => {
      if (wordCount[word] > 1) {
        duplicates.push(word);
      }
    });

    return duplicates;
  }

  analyzeTechnicalSeo($) {
    return {
      // Mobile Responsiveness - Viewport meta tag
      hasViewport: !!$('meta[name="viewport"]').length,
      viewportContent: $('meta[name="viewport"]').attr('content') || null,

      // Schema Markup - JSON-LD
      hasJsonLd: !!$('script[type="application/ld+json"]').length,
      jsonLdCount: $('script[type="application/ld+json"]').length,
      jsonLdSchemas: $('script[type="application/ld+json"]').map((i, el) => {
        try {
          const content = $(el).html();
          const parsed = JSON.parse(content);
          return parsed['@type'] || 'Unknown';
        } catch (e) {
          return 'Invalid JSON';
        }
      }).get(),
      jsonLdData: $('script[type="application/ld+json"]').map((i, el) => {
        try {
          const content = $(el).html();
          const parsed = JSON.parse(content);
          return {
            type: parsed['@type'] || 'Unknown',
            content: content,
            parsed: parsed,
            isValid: true
          };
        } catch (e) {
          return {
            type: 'Invalid JSON',
            content: $(el).html(),
            parsed: null,
            isValid: false,
            error: e.message
          };
        }
      }).get(),

      // Schema Markup - Microdata
      hasMicrodata: !!$('[itemtype], [itemscope], [itemprop]').length,
      microdataCount: $('[itemtype], [itemscope], [itemprop]').length,
      microdataItems: $('[itemscope]').map((i, el) => {
        const $item = $(el);
        const itemType = $item.attr('itemtype');
        const itemProps = {};

        // Find all itemprop elements within this itemscope
        $item.find('[itemprop]').each((j, propEl) => {
          const $prop = $(propEl);
          const propName = $prop.attr('itemprop');
          let propValue;

          if ($prop.attr('content')) {
            propValue = $prop.attr('content');
          } else if ($prop.attr('href')) {
            propValue = $prop.attr('href');
          } else if ($prop.attr('src')) {
            propValue = $prop.attr('src');
          } else {
            propValue = $prop.text().trim();
          }

          if (propName) {
            itemProps[propName] = propValue;
          }
        });

        return {
          itemType: itemType || 'No itemtype',
          properties: itemProps,
          outerHTML: $item.prop('outerHTML')?.substring(0, 500) + '...' // Truncate for size
        };
      }).get(),

      // Canonical Tags
      hasCanonical: !!$('link[rel="canonical"]').length,
      canonicalUrl: $('link[rel="canonical"]').attr('href') || null,

      // Robots Meta Tags
      hasRobotsMeta: !!$('meta[name="robots"]').length,
      robotsContent: $('meta[name="robots"]').attr('content') || null,
      isIndexable: !$('meta[name="robots"]').attr('content')?.toLowerCase().includes('noindex'),
      isFollowable: !$('meta[name="robots"]').attr('content')?.toLowerCase().includes('nofollow'),

      // Cross-selling Detection - look for td elements within CrossellingCount table
      hasCrossSelling: !!$('.CrossellingCount td').length,
      crossSellingCount: $('.CrossellingCount td').length,
      crossSellingProducts: $('.CrossellingCount td').map((i, el) => {
        // Extract product name from the content
        const $el = $(el);
        // Try multiple strategies to extract product name
        let productName = '';

        // Strategy 1: Look for link text in anchor tags
        const linkText = $el.find('a').first().text().trim();
        if (linkText && !linkText.includes('£') && linkText !== 'VIEW OPTIONS') {
          productName = linkText;
        }

        // Strategy 2: Extract from the beginning of text content
        if (!productName) {
          const fullText = $el.text().trim();
          // Get the first line which usually contains the product name
          const firstLine = fullText.split('\n')[0];
          if (firstLine) {
            const cleanLine = firstLine.replace(/£[\d.]+/g, '').replace(/from/g, '').trim();
            if (cleanLine.length > 3 &&
                !cleanLine.match(/^£\d+\.\d+$/) &&
                cleanLine !== 'VIEW OPTIONS' &&
                !cleanLine.match(/^\d+$/)) {
              productName = cleanLine;
            }
          }
        }

        return productName;
      }).get().filter(text => text && text.length > 3),

    };
  }

  processPages(crawlResults) {
    return crawlResults.map(result => {
      if (!result.success) {
        return {
          url: result.url,
          title: null,
          metaDescription: null,
          hasMetaDescription: false,
          characterCount: 0,
          status: 'error',
          issues: [`Failed to fetch: ${result.error}`],
          httpStatus: result.status,
          mboUrl: null,
          dataLayer: result.dataLayer || { objectId: null, hasDataLayer: false }
        };
      }

      const metaData = this.extractMetaData(result.html, result.url);

      // Add MBO and data layer information
      metaData.mboUrl = result.mboUrl || null;
      metaData.dataLayer = result.dataLayer || { objectId: null, hasDataLayer: false };

      // Debug: Log what data layer info we got
      if (result.dataLayer) {
      }

      return metaData;
    });
  }
}