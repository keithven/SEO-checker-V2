import axios from 'axios';
import { parseString } from 'xml2js';

export class SitemapParser {
  async parseXmlSitemap(sitemapUrl) {
    try {
      const response = await axios.get(sitemapUrl);
      const xml = response.data;

      return new Promise((resolve, reject) => {
        parseString(xml, (err, result) => {
          if (err) {
            reject(err);
            return;
          }

          const urls = [];

          if (result.urlset && result.urlset.url) {
            for (const url of result.urlset.url) {
              if (url.loc && url.loc[0]) {
                urls.push({
                  url: url.loc[0],
                  lastmod: url.lastmod ? url.lastmod[0] : null,
                  priority: url.priority ? parseFloat(url.priority[0]) : null
                });
              }
            }
          }

          if (result.sitemapindex && result.sitemapindex.sitemap) {
            for (const sitemap of result.sitemapindex.sitemap) {
              if (sitemap.loc && sitemap.loc[0]) {
                urls.push({
                  url: sitemap.loc[0],
                  type: 'sitemap',
                  lastmod: sitemap.lastmod ? sitemap.lastmod[0] : null
                });
              }
            }
          }

          resolve(urls);
        });
      });
    } catch (error) {
      throw new Error(`Failed to fetch sitemap: ${error.message}`);
    }
  }

  async getAllUrls(sitemapUrl) {
    const initialUrls = await this.parseXmlSitemap(sitemapUrl);
    const allUrls = [];

    for (const item of initialUrls) {
      if (item.type === 'sitemap') {
        const subUrls = await this.getAllUrls(item.url);
        allUrls.push(...subUrls);
      } else {
        allUrls.push(item.url);
      }
    }

    return allUrls;
  }
}