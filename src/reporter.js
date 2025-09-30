import fs from 'fs';

export class Reporter {
  constructor() {
    this.results = [];
  }

  setResults(results) {
    this.results = results;
  }

  generateSummary() {
    const total = this.results.length;
    const withMetaDescription = this.results.filter(r => r.hasMetaDescription).length;
    const needsAttention = this.results.filter(r => r.status === 'needs_attention').length;
    const errors = this.results.filter(r => r.status === 'error').length;
    const good = this.results.filter(r => r.status === 'good').length;

    return {
      total,
      withMetaDescription,
      missingMetaDescription: total - withMetaDescription - errors,
      needsAttention,
      errors,
      good,
      percentageWithMeta: Math.round((withMetaDescription / (total - errors)) * 100) || 0
    };
  }

  printConsoleReport() {
    const summary = this.generateSummary();

    console.log('\n' + '='.repeat(60));
    console.log('SEO META DESCRIPTION ANALYSIS REPORT');
    console.log('='.repeat(60));

    console.log('\nSUMMARY:');
    console.log(`📊 Total pages analyzed: ${summary.total}`);
    console.log(`✅ Pages with meta descriptions: ${summary.withMetaDescription} (${summary.percentageWithMeta}%)`);
    console.log(`❌ Missing meta descriptions: ${summary.missingMetaDescription}`);
    console.log(`⚠️  Pages needing attention: ${summary.needsAttention}`);
    console.log(`🔴 Errors: ${summary.errors}`);
    console.log(`🟢 Pages in good shape: ${summary.good}`);

    console.log('\nDETAILED RESULTS:');
    console.log('-'.repeat(60));

    this.results.forEach((result, index) => {
      const statusIcon = this.getStatusIcon(result.status);
      console.log(`\n${index + 1}. ${statusIcon} ${result.url}`);

      if (result.title) {
        console.log(`   Title: ${result.title}`);
      }

      if (result.hasMetaDescription) {
        console.log(`   Meta Description (${result.characterCount} chars): ${result.metaDescription}`);
      } else {
        console.log('   Meta Description: ❌ MISSING');
      }

      if (result.issues && result.issues.length > 0) {
        console.log('   Issues:');
        result.issues.forEach(issue => {
          console.log(`     • ${issue}`);
        });
      }
    });

    console.log('\n' + '='.repeat(60));
  }

  getStatusIcon(status) {
    switch (status) {
      case 'good': return '🟢';
      case 'needs_attention': return '⚠️';
      case 'error': return '🔴';
      default: return '❓';
    }
  }

  generateJsonReport() {
    const summary = this.generateSummary();
    return {
      summary,
      timestamp: new Date().toISOString(),
      results: this.results
    };
  }

  generateCsvReport() {
    const headers = [
      'URL',
      'Title',
      'Has Meta Description',
      'Meta Description',
      'Character Count',
      'Status',
      'Issues'
    ];

    const rows = this.results.map(result => [
      result.url,
      result.title || '',
      result.hasMetaDescription ? 'Yes' : 'No',
      result.metaDescription || '',
      result.characterCount,
      result.status,
      result.issues ? result.issues.join('; ') : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    return csvContent;
  }

  async saveReport(format = 'json', filename = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    if (!filename) {
      filename = `seo-report-${timestamp}.${format}`;
    }

    let content;
    switch (format.toLowerCase()) {
      case 'json':
        content = JSON.stringify(this.generateJsonReport(), null, 2);
        break;
      case 'csv':
        content = this.generateCsvReport();
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    fs.writeFileSync(filename, content, 'utf8');
    console.log(`\n📄 Report saved as: ${filename}`);
    return filename;
  }

  printIssuesSummary() {
    const issueCategories = {};

    this.results.forEach(result => {
      if (result.issues) {
        result.issues.forEach(issue => {
          const category = this.categorizeIssue(issue);
          if (!issueCategories[category]) {
            issueCategories[category] = { count: 0, pages: [] };
          }
          issueCategories[category].count++;
          issueCategories[category].pages.push(result.url);
        });
      }
    });

    if (Object.keys(issueCategories).length > 0) {
      console.log('\nISSUES BREAKDOWN:');
      console.log('-'.repeat(40));

      Object.entries(issueCategories)
        .sort(([,a], [,b]) => b.count - a.count)
        .forEach(([category, data]) => {
          console.log(`${category}: ${data.count} pages`);
        });
    }
  }

  categorizeIssue(issue) {
    if (issue.includes('Missing meta description')) return 'Missing Meta Description';
    if (issue.includes('too short')) return 'Too Short';
    if (issue.includes('too long')) return 'Too Long';
    if (issue.includes('identical to title')) return 'Duplicate Title';
    if (issue.includes('Lorem ipsum')) return 'Placeholder Text';
    if (issue.includes('repeated words')) return 'Repeated Words';
    if (issue.includes('punctuation')) return 'Missing Punctuation';
    if (issue.includes('Failed to fetch')) return 'Fetch Errors';
    return 'Other';
  }
}