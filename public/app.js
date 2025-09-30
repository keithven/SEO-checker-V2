class SEOCheckerV2 {
    constructor() {
        this.socket = io();
        this.currentResults = null;
        this.currentTree = null;
        this.filteredResults = null;
        this.currentView = 'all';
        this.hideDone = false;
        this.theme = localStorage.getItem('theme') || 'light';

        this.initializeTheme();
        this.initializeEventListeners();
        this.setupSocketListeners();
        this.setupKeyboardShortcuts();
    }

    initializeTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        const icon = document.getElementById('themeIcon');
        if (icon) {
            icon.className = this.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', this.theme);
        this.initializeTheme();
    }

    initializeEventListeners() {
        // Form submission
        document.getElementById('analysisForm')?.addEventListener('submit', this.startAnalysis.bind(this));

        // Buttons
        document.getElementById('loadSavedBtn')?.addEventListener('click', this.loadSavedResults.bind(this));
        document.getElementById('detectDuplicatesBtn')?.addEventListener('click', this.detectDuplicates.bind(this));
        document.getElementById('showHistogramBtn')?.addEventListener('click', this.toggleHistogram.bind(this));
        document.getElementById('themeToggle')?.addEventListener('click', this.toggleTheme.bind(this));
        document.getElementById('shortcutsBtn')?.addEventListener('click', this.showShortcuts.bind(this));
        document.getElementById('exportJsonBtn')?.addEventListener('click', () => this.exportResults('json'));
        document.getElementById('exportCsvBtn')?.addEventListener('click', () => this.exportResults('csv'));

        // Filters
        document.getElementById('searchFilter')?.addEventListener('input', this.applyFilters.bind(this));
        document.getElementById('statusFilter')?.addEventListener('change', this.applyFilters.bind(this));
        document.getElementById('reviewStatusFilter')?.addEventListener('change', this.applyFilters.bind(this));
        document.getElementById('hideDoneCheckbox')?.addEventListener('change', this.toggleHideDone.bind(this));

        // View mode tabs
        document.querySelectorAll('.view-mode-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                this.switchView(view);
            });
        });
    }

    setupSocketListeners() {
        this.socket.on('progress', (data) => {
            this.updateProgress(data);
        });

        this.socket.on('crawl-progress', (data) => {
            this.updateCrawlProgress(data);
        });

        this.socket.on('complete', (data) => {
            this.displayResults(data);
        });

        this.socket.on('error', (data) => {
            this.showError(data.error);
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+D: Toggle dark mode
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                this.toggleTheme();
            }

            // ?: Show shortcuts
            if (e.key === '?' && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                this.showShortcuts();
            }

            // Ctrl+H: Toggle hide done
            if (e.ctrlKey && e.key === 'h') {
                e.preventDefault();
                const checkbox = document.getElementById('hideDoneCheckbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    this.toggleHideDone();
                }
            }

            // Ctrl+F: Focus search (browser default, but ensure it works)
            if (e.ctrlKey && e.key === 'f') {
                const searchInput = document.getElementById('searchFilter');
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                }
            }

            // Ctrl+E: Export JSON
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.exportResults('json');
            }

            // Escape: Close shortcuts overlay
            if (e.key === 'Escape') {
                const overlay = document.getElementById('shortcutsOverlay');
                if (overlay?.classList.contains('show')) {
                    overlay.classList.remove('show');
                }
            }
        });
    }

    showShortcuts() {
        const overlay = document.getElementById('shortcutsOverlay');
        if (overlay) {
            overlay.classList.add('show');
        }
    }

    async startAnalysis(event) {
        event.preventDefault();

        const sitemapUrl = document.getElementById('sitemapUrl').value;
        const scanMode = document.getElementById('scanMode').value;
        const maxPages = document.getElementById('maxPages').value;
        const delay = document.getElementById('delay').value;
        const timeout = document.getElementById('timeout').value;
        const chunkSize = document.getElementById('chunkSize').value;

        const options = {
            scanMode: scanMode,
            maxPages: parseInt(maxPages),
            delay: parseInt(delay),
            timeout: parseInt(timeout),
            chunkSize: parseInt(chunkSize)
        };

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sitemapUrl, options })
            });

            const data = await response.json();

            if (response.ok) {
                document.getElementById('progressContainer').style.display = 'block';
                document.getElementById('resultsContainer').style.display = 'none';
            } else {
                this.showError(data.error);
            }
        } catch (error) {
            this.showError('Failed to start analysis: ' + error.message);
        }
    }

    updateProgress(data) {
        const progressBar = document.getElementById('progressBar');
        const progressMessage = document.getElementById('progressMessage');
        const progressTitle = document.getElementById('progressTitle');

        if (progressTitle) {
            progressTitle.textContent = data.step.charAt(0).toUpperCase() + data.step.slice(1);
        }

        if (progressMessage) {
            progressMessage.textContent = data.message;
        }

        if (data.percentage !== undefined && progressBar) {
            progressBar.style.width = data.percentage + '%';
            progressBar.textContent = data.percentage + '%';
        }
    }

    updateCrawlProgress(data) {
        const progressBar = document.getElementById('progressBar');
        const progressMessage = document.getElementById('progressMessage');

        if (progressBar) {
            progressBar.style.width = data.percentage + '%';
            progressBar.textContent = data.percentage + '%';
        }

        if (progressMessage) {
            progressMessage.textContent = `Crawling: ${data.current}/${data.total} URLs (${data.percentage}%)`;
        }
    }

    displayResults(data) {
        this.currentResults = data.results.results;
        this.currentTree = data.results.tree;

        document.getElementById('progressContainer').style.display = 'none';
        document.getElementById('resultsContainer').style.display = 'block';

        this.renderStats(data.summary);
        this.renderCharacterHistogram();
        this.applyFilters();

        this.showNotification('Analysis complete!', 'success');
    }

    renderStats(summary) {
        const statsOverview = document.getElementById('statsOverview');
        if (!statsOverview) return;

        const total = summary.total || 0;
        const good = summary.good || 0;
        const warning = summary.warning || 0;
        const errors = summary.error || summary.errors || 0;
        const withMeta = summary.withMetaDescription || 0;
        const percentageWithMeta = summary.percentageWithMeta || 0;

        statsOverview.innerHTML = `
            <div class="col-md-2">
                <div class="stat-card-v2">
                    <span class="stat-number">${total}</span>
                    <span class="stat-label">Total URLs</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2">
                    <span class="stat-number status-good">${good}</span>
                    <span class="stat-label">Good</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2">
                    <span class="stat-number status-warning">${warning}</span>
                    <span class="stat-label">Warnings</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2">
                    <span class="stat-number status-error">${errors}</span>
                    <span class="stat-label">Errors</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2">
                    <span class="stat-number">${withMeta}</span>
                    <span class="stat-label">With Meta</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2">
                    <span class="stat-number">${percentageWithMeta}%</span>
                    <span class="stat-label">Coverage</span>
                </div>
            </div>
        `;
    }

    renderCharacterHistogram() {
        if (!this.currentResults) return;

        const ranges = {
            '0 (Missing)': 0,
            '1-50 (Too Short)': 0,
            '51-120 (Short)': 0,
            '121-160 (Optimal)': 0,
            '161-200 (Long)': 0,
            '200+ (Too Long)': 0
        };

        this.currentResults.forEach(result => {
            const length = result.characterCount || 0;
            if (length === 0) ranges['0 (Missing)']++;
            else if (length <= 50) ranges['1-50 (Too Short)']++;
            else if (length <= 120) ranges['51-120 (Short)']++;
            else if (length <= 160) ranges['121-160 (Optimal)']++;
            else if (length <= 200) ranges['161-200 (Long)']++;
            else ranges['200+ (Too Long)']++;
        });

        const maxCount = Math.max(...Object.values(ranges));
        const histogramBars = document.getElementById('histogramBars');

        if (!histogramBars) return;

        histogramBars.innerHTML = '';

        Object.entries(ranges).forEach(([label, count]) => {
            const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
            let color = '#6c757d';

            if (label.includes('Optimal')) color = '#28a745';
            else if (label.includes('Missing') || label.includes('Too')) color = '#dc3545';
            else if (label.includes('Short') || label.includes('Long')) color = '#ffc107';

            const barHTML = `
                <div class="histogram-bar">
                    <div class="histogram-label">${label}</div>
                    <div class="histogram-track">
                        <div class="histogram-fill" style="width: ${percentage}%; background-color: ${color};">
                            ${count}
                        </div>
                    </div>
                </div>
            `;
            histogramBars.innerHTML += barHTML;
        });
    }

    toggleHistogram() {
        const histogram = document.getElementById('characterHistogram');
        if (histogram) {
            histogram.classList.toggle('hidden');
        }
    }

    async detectDuplicates() {
        const sitemapUrl = document.getElementById('sitemapUrl').value;

        if (!sitemapUrl) {
            this.showError('Please enter a sitemap URL first');
            return;
        }

        try {
            const response = await fetch('/api/detect-duplicates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sitemapUrl })
            });

            const data = await response.json();

            if (response.ok) {
                this.displayDuplicates(data);
            } else {
                this.showError(data.error);
            }
        } catch (error) {
            this.showError('Failed to detect duplicates: ' + error.message);
        }
    }

    displayDuplicates(data) {
        const container = document.getElementById('duplicatesContainer');
        if (!container) return;

        if (data.duplicates.length === 0) {
            container.innerHTML = `
                <div class="alert alert-success">
                    <i class="fas fa-check-circle"></i> No duplicate meta descriptions found! All meta descriptions are unique.
                </div>
            `;
            return;
        }

        let html = `
            <div class="duplicate-alert">
                <h4><i class="fas fa-exclamation-triangle"></i> Duplicate Meta Descriptions Found</h4>
                <p>Found <strong>${data.total}</strong> duplicate meta descriptions affecting <strong>${data.affectedUrls}</strong> URLs.</p>
            </div>
        `;

        data.duplicates.forEach((dup, index) => {
            html += `
                <div class="card mt-3">
                    <div class="card-body">
                        <h5>Duplicate #${index + 1} - ${dup.count} URLs</h5>
                        <div class="meta-description mb-3">
                            "${dup.metaDescription}"
                            <button class="copy-btn ms-2" onclick="app.copyToClipboard('${dup.metaDescription.replace(/'/g, "\\'")}', this)">
                                <i class="fas fa-copy"></i> Copy
                            </button>
                        </div>
                        <h6>URLs using this description:</h6>
                        <ul class="list-unstyled">
                            ${dup.urls.map(u => `
                                <li class="mb-2">
                                    <span class="badge bg-${u.status === 'good' ? 'success' : u.status === 'warning' ? 'warning' : 'danger'}">
                                        ${u.status}
                                    </span>
                                    <a href="${u.url}" target="_blank" class="ms-2">${u.url}</a>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    switchView(view) {
        this.currentView = view;

        // Update active tab
        document.querySelectorAll('.view-mode-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.view === view) {
                tab.classList.add('active');
            }
        });

        // Show/hide tree view
        const treeView = document.getElementById('treeViewContainer');
        const resultsList = document.getElementById('resultsList');

        if (view === 'tree') {
            treeView?.classList.remove('hidden');
            resultsList?.classList.add('hidden');
            this.renderTreeView();
        } else {
            treeView?.classList.add('hidden');
            resultsList?.classList.remove('hidden');
            this.applyFilters();
        }
    }

    renderTreeView() {
        const treeRoot = document.getElementById('treeRoot');
        if (!treeRoot || !this.currentTree) return;

        treeRoot.innerHTML = this.buildTreeHTML(this.currentTree);

        // Add click handlers to tree nodes
        document.querySelectorAll('.tree-node-header').forEach(header => {
            header.addEventListener('click', (e) => {
                const children = e.currentTarget.nextElementSibling;
                const icon = e.currentTarget.querySelector('.tree-node-icon i');

                if (children) {
                    children.classList.toggle('expanded');
                    if (icon) {
                        icon.className = children.classList.contains('expanded') ?
                            'fas fa-folder-open' : 'fas fa-folder';
                    }
                }
            });
        });
    }

    buildTreeHTML(node, level = 0) {
        if (!node) return '';

        const hasChildren = Object.keys(node.children || {}).length > 0;
        const hasUrls = (node.urls || []).length > 0;

        let html = '';

        if (level > 0) {
            html += `
                <div class="tree-node">
                    <div class="tree-node-header">
                        <span class="tree-node-icon">
                            <i class="fas fa-${hasChildren ? 'folder' : 'file'}"></i>
                        </span>
                        <span class="tree-node-name">${node.name}</span>
                        <div class="tree-node-stats">
                            <span class="tree-node-stat bg-good">${node.stats.good}</span>
                            <span class="tree-node-stat bg-warning">${node.stats.warning}</span>
                            <span class="tree-node-stat bg-error">${node.stats.error}</span>
                        </div>
                    </div>
                    <div class="tree-children">
            `;
        } else {
            html += '<div class="tree-children expanded">';
        }

        // Render child folders
        Object.values(node.children || {}).forEach(child => {
            html += this.buildTreeHTML(child, level + 1);
        });

        // Render URLs at this level
        if (hasUrls) {
            node.urls.forEach(url => {
                html += this.renderUrlItemHTML(url, true);
            });
        }

        html += '</div></div>';

        return html;
    }

    applyFilters() {
        if (!this.currentResults) return;

        const searchTerm = document.getElementById('searchFilter')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('statusFilter')?.value || '';
        const reviewFilter = document.getElementById('reviewStatusFilter')?.value || '';

        let filtered = this.currentResults.filter(result => {
            // Search filter
            if (searchTerm && !result.url.toLowerCase().includes(searchTerm)) {
                return false;
            }

            // Status filter
            if (statusFilter && result.status !== statusFilter) {
                return false;
            }

            // Review status filter
            if (reviewFilter && result.reviewStatus !== reviewFilter) {
                return false;
            }

            // View mode filter
            if (this.currentView === 'needs-attention' && result.status === 'good') {
                return false;
            }

            if (this.currentView === 'in-progress' && result.reviewStatus !== 'in_progress') {
                return false;
            }

            // Hide done filter
            if (this.hideDone && result.reviewStatus === 'reviewed') {
                return false;
            }

            return true;
        });

        this.filteredResults = filtered;
        this.renderResults();
    }

    toggleHideDone() {
        this.hideDone = document.getElementById('hideDoneCheckbox')?.checked || false;
        this.applyFilters();
    }

    renderResults() {
        const resultsList = document.getElementById('resultsList');
        if (!resultsList || !this.filteredResults) return;

        if (this.filteredResults.length === 0) {
            resultsList.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> No results match your filters.
                </div>
            `;
            return;
        }

        resultsList.innerHTML = this.filteredResults.map(result =>
            this.renderUrlItemHTML(result)
        ).join('');
    }

    renderUrlItemHTML(result, inTree = false) {
        const statusClass = result.status || 'warning';
        const charCount = result.characterCount || 0;
        const charCountClass = charCount >= 120 && charCount <= 160 ? 'good' :
                               charCount > 0 ? 'warning' : 'error';

        return `
            <div class="url-item-v2 ${statusClass}" data-url="${result.url}">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div class="flex-grow-1">
                        <a href="${result.url}" target="_blank" class="text-decoration-none">
                            <strong>${result.url}</strong>
                        </a>
                    </div>
                    <div class="d-flex gap-2">
                        <span class="badge bg-${statusClass}">${result.status}</span>
                        <span class="badge bg-secondary">${result.reviewStatus || 'new'}</span>
                    </div>
                </div>

                ${result.title ? `
                    <div class="mb-2">
                        <strong>Title:</strong> ${result.title}
                    </div>
                ` : ''}

                <div class="mb-2">
                    <strong>Meta Description
                        <span class="char-count ${charCountClass}">(${charCount} chars)</span>
                    </strong>
                    <button class="copy-btn ms-2" onclick="app.copyToClipboard('${(result.metaDescription || '').replace(/'/g, "\\'")}', this)">
                        <i class="fas fa-copy"></i> Copy
                    </button>
                </div>
                <div class="meta-description">
                    ${result.metaDescription || '<em>No meta description</em>'}
                </div>

                ${result.issues && result.issues.length > 0 ? `
                    <div class="mt-2">
                        <strong>Issues:</strong>
                        <ul class="issue-list">
                            ${result.issues.map(issue => `<li>${issue}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        `;
    }

    async loadSavedResults() {
        const sitemapUrl = document.getElementById('sitemapUrl').value;

        if (!sitemapUrl) {
            this.showError('Please enter a sitemap URL first');
            return;
        }

        try {
            const response = await fetch(`/api/scan-results?sitemapUrl=${encodeURIComponent(sitemapUrl)}`);
            const data = await response.json();

            if (response.ok && data.results && data.results.length > 0) {
                this.currentResults = data.results;
                this.currentTree = data.tree;

                document.getElementById('resultsContainer').style.display = 'block';

                // Calculate summary from results
                const summary = {
                    total: data.results.length,
                    good: data.results.filter(r => r.status === 'good').length,
                    warning: data.results.filter(r => r.status === 'warning').length,
                    error: data.results.filter(r => r.status === 'error').length,
                    withMetaDescription: data.results.filter(r => r.hasMetaDescription).length,
                    percentageWithMeta: Math.round((data.results.filter(r => r.hasMetaDescription).length / data.results.length) * 100)
                };

                this.renderStats(summary);
                this.renderCharacterHistogram();
                this.applyFilters();

                this.showNotification('Saved results loaded successfully!', 'success');
            } else {
                this.showError('No saved results found for this sitemap');
            }
        } catch (error) {
            this.showError('Failed to load saved results: ' + error.message);
        }
    }

    async exportResults(format) {
        if (!this.currentResults) {
            this.showError('No results to export');
            return;
        }

        const resultsData = encodeURIComponent(JSON.stringify({ results: this.filteredResults || this.currentResults }));
        window.location.href = `/api/export/${format}?results=${resultsData}`;
    }

    copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            const originalHTML = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i> Copied!';
            button.classList.add('copied');

            setTimeout(() => {
                button.innerHTML = originalHTML;
                button.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            this.showError('Failed to copy: ' + err.message);
        });
    }

    showNotification(message, type = 'info') {
        // Simple toast notification
        const toast = document.createElement('div');
        toast.className = `alert alert-${type} position-fixed top-0 end-0 m-3`;
        toast.style.zIndex = '9999';
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
            ${message}
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    showError(message) {
        this.showNotification(message, 'danger');
        console.error(message);
    }
}

// Initialize the app
const app = new SEOCheckerV2();