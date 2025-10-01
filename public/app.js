class SEOCheckerV2 {
    constructor() {
        this.socket = io();
        this.currentResults = null;
        this.currentTree = null;
        this.filteredResults = null;
        this.currentView = 'all';
        this.hideDone = false;
        this.theme = localStorage.getItem('theme') || 'light';
        this.mboSession = null;
        this.selectiveUrls = [];
        this.filteredSelectiveUrls = [];
        this.selectedSelectiveUrls = new Set();

        // AI Cost Tracking
        this.loadAICostTracking();

        this.initializeTheme();
        this.loadMboSession();
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

    loadMboSession() {
        try {
            const savedSession = localStorage.getItem('mboSession');
            if (savedSession) {
                this.mboSession = JSON.parse(savedSession);

                // Update UI to show saved session
                const statusIndicator = document.getElementById('mboStatusIndicator');
                const statusText = document.getElementById('mboStatus');
                const mboButton = document.getElementById('manualMboBtn');
                const buttonText = document.getElementById('mboButtonText');

                if (statusIndicator && statusText && mboButton && buttonText) {
                    statusIndicator.style.display = 'block';
                    statusText.innerHTML = `<span class="text-success"><i class="fas fa-check-circle"></i> Token active (${this.mboSession.token.substring(0, 8)}...)</span>`;
                    buttonText.textContent = 'MBO Token Active';
                    mboButton.classList.remove('btn-outline-info');
                    mboButton.classList.add('btn-success');
                }

                console.log('✓ MBO session loaded from localStorage');
            }
        } catch (e) {
            console.error('Error loading MBO session:', e);
        }
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
        document.getElementById('bulkAIBtn')?.addEventListener('click', this.showBulkAIModal.bind(this));
        document.getElementById('detectMboBtn')?.addEventListener('click', this.detectMboSession.bind(this));
        document.getElementById('manualMboBtn')?.addEventListener('click', this.toggleManualMboEntry.bind(this));
        document.getElementById('saveMboTokenBtn')?.addEventListener('click', this.saveManualMboToken.bind(this));
        document.getElementById('clearMboBtn')?.addEventListener('click', this.clearMboSession.bind(this));

        // Saved scan selector
        document.getElementById('savedScanSelector')?.addEventListener('change', this.handleSavedScanSelection.bind(this));

        // Load saved scans on init
        this.loadSavedScans();

        // Selective scan
        document.getElementById('selectiveScanBtn')?.addEventListener('click', this.showSelectiveScanModal.bind(this));
        document.getElementById('selectAllUnscannedBtn')?.addEventListener('click', this.selectAllUnscanned.bind(this));
        document.getElementById('selectNoneSelectiveBtn')?.addEventListener('click', this.selectNoneSelective.bind(this));
        document.getElementById('scanSelectedBtn')?.addEventListener('click', this.scanSelectedUrls.bind(this));
        document.getElementById('selectiveSearchFilter')?.addEventListener('input', this.filterSelectiveUrls.bind(this));
        document.getElementById('selectiveScanFilter')?.addEventListener('change', this.filterSelectiveUrls.bind(this));

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

        // Modal event listeners to restore UI after close
        const urlDetailsModal = document.getElementById('urlDetailsModal');
        if (urlDetailsModal) {
            urlDetailsModal.addEventListener('hidden.bs.modal', () => {
                // Re-render results to restore interactivity
                if (this.currentResults) {
                    this.applyFilters();
                }
                // Ensure body is scrollable
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
                document.body.classList.remove('modal-open');
            });
        }

        // Save URL changes button
        document.getElementById('saveUrlChanges')?.addEventListener('click', this.saveUrlChanges.bind(this));

        // Review status button delegation
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.review-status-btn');
            if (btn) {
                const buttonGroup = btn.closest('.review-status-buttons');
                const url = buttonGroup.dataset.url;
                const status = btn.dataset.status;
                this.handleReviewStatusClick(url, status, buttonGroup);
            }
        });
    }

    setupSocketListeners() {
        this.socket.on('progress', (data) => {
            // Check if selective scan modal is open
            const selectiveModal = document.getElementById('selectiveScanModal');
            if (selectiveModal && selectiveModal.classList.contains('show')) {
                // Update selective scan progress
                this.updateSelectiveProgress(data);
            } else {
                this.updateProgress(data);
            }
        });

        this.socket.on('crawl-progress', (data) => {
            // Check if selective scan modal is open
            const selectiveModal = document.getElementById('selectiveScanModal');
            if (selectiveModal && selectiveModal.classList.contains('show')) {
                // Update selective scan crawl progress
                this.updateSelectiveCrawlProgress(data);
            } else {
                this.updateCrawlProgress(data);
            }
        });

        this.socket.on('complete', (data) => {
            // Check if this is a selective scan completion
            if (data.results && data.results.scanType === 'selective') {
                this.handleSelectiveScanComplete(data);
            } else {
                this.displayResults(data);
            }
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
            chunkSize: parseInt(chunkSize),
            enableMboDetection: true  // Always use Puppeteer to get object IDs
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

    renderStats(summary = null) {
        const statsOverview = document.getElementById('statsOverview');
        if (!statsOverview) return;

        let total, good, warning, errors, withMeta, percentageWithMeta;

        // Always calculate stats from current results for real-time accuracy
        if (this.currentResults && this.currentResults.length > 0) {
            total = this.currentResults.length;
            good = this.currentResults.filter(r => r.status === 'good').length;
            warning = this.currentResults.filter(r => r.status === 'warning' || r.status === 'needs_attention').length;
            errors = this.currentResults.filter(r => r.status === 'error').length;
            withMeta = this.currentResults.filter(r => r.hasMetaDescription).length;
            percentageWithMeta = total > 0 ? Math.round((withMeta / total) * 100) : 0;
        } else if (summary) {
            // Fallback to summary if no currentResults yet
            total = summary.total || 0;
            good = summary.good || 0;
            warning = summary.warning || 0;
            errors = summary.error || summary.errors || 0;
            withMeta = summary.withMetaDescription || 0;
            percentageWithMeta = total > 0 ? Math.round((withMeta / total) * 100) : 0;
        } else {
            return; // No data to display
        }

        statsOverview.innerHTML = `
            <div class="col-md-2">
                <div class="stat-card-v2" onclick="app.filterByStatCard('all')" style="cursor: pointer;">
                    <span class="stat-number">${total}</span>
                    <span class="stat-label">Total URLs</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2" onclick="app.filterByStatCard('good')" style="cursor: pointer;">
                    <span class="stat-number status-good">${good}</span>
                    <span class="stat-label">Good</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2" onclick="app.filterByStatCard('warning')" style="cursor: pointer;">
                    <span class="stat-number status-warning">${warning}</span>
                    <span class="stat-label">Warnings</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2" onclick="app.filterByStatCard('error')" style="cursor: pointer;">
                    <span class="stat-number status-error">${errors}</span>
                    <span class="stat-label">Errors</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2" onclick="app.filterByStatCard('withMeta')" style="cursor: pointer;">
                    <span class="stat-number">${withMeta}</span>
                    <span class="stat-label">With Meta</span>
                </div>
            </div>
            <div class="col-md-2">
                <div class="stat-card-v2" style="cursor: default;">
                    <span class="stat-number">${percentageWithMeta}%</span>
                    <span class="stat-label">Coverage</span>
                </div>
            </div>
        `;
    }

    filterByStatCard(filterType) {
        if (!this.currentResults) return;

        // Switch to "All Items" view
        this.currentView = 'all';
        document.querySelectorAll('.view-mode-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.view === 'all') {
                tab.classList.add('active');
            }
        });

        // Apply the filter
        if (filterType === 'all') {
            this.filteredResults = this.currentResults;
        } else if (filterType === 'good') {
            this.filteredResults = this.currentResults.filter(r => r.status === 'good');
        } else if (filterType === 'warning') {
            this.filteredResults = this.currentResults.filter(r => r.status === 'warning' || r.status === 'needs_attention');
        } else if (filterType === 'error') {
            this.filteredResults = this.currentResults.filter(r => r.status === 'error');
        } else if (filterType === 'withMeta') {
            this.filteredResults = this.currentResults.filter(r => r.hasMetaDescription);
        }

        // Show list view
        document.getElementById('treeViewContainer')?.classList.add('hidden');
        document.getElementById('resultsList')?.classList.remove('hidden');

        // Render filtered results
        this.renderResults(this.filteredResults);

        // Show notification
        const labels = {
            all: 'all URLs',
            good: 'URLs with good status',
            warning: 'URLs with warnings',
            error: 'URLs with errors',
            withMeta: 'URLs with meta descriptions'
        };
        this.showNotification(`Showing ${labels[filterType]} (${this.filteredResults.length})`, 'info');
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
            // Always re-apply filters when switching to a list view
            this.applyFilters();
        }
    }

    buildUrlTree(results) {
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

        // Calculate stats recursively
        const calculateStats = (node) => {
            let stats = { good: 0, warning: 0, error: 0, total: 0 };

            node.urls.forEach(url => {
                const status = url.status;
                if (status === 'needs_attention') {
                    stats.warning++;
                } else if (stats.hasOwnProperty(status)) {
                    stats[status]++;
                } else {
                    stats.warning++;
                }
                stats.total++;
            });

            Object.values(node.children).forEach(child => {
                const childStats = calculateStats(child);
                stats.good += childStats.good;
                stats.warning += childStats.warning;
                stats.error += childStats.error;
                stats.total += childStats.total;
            });

            node.stats = stats;
            return stats;
        };

        calculateStats(tree);
        return tree;
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
            const total = node.stats.good + node.stats.warning + node.stats.error;
            html += `
                <div class="tree-node">
                    <div class="tree-node-header">
                        <span class="tree-node-icon">
                            <i class="fas fa-${hasChildren ? 'folder' : 'file'}"></i>
                        </span>
                        <span class="tree-node-name">${node.name}</span>
                        <div class="tree-node-stats">
                            <span class="badge bg-secondary" style="font-size: 0.75rem;">
                                ${total} URL${total !== 1 ? 's' : ''}
                            </span>
                            ${node.stats.good > 0 ? `<span class="badge bg-success" style="font-size: 0.75rem;" title="${node.stats.good} good"><i class="fas fa-check"></i> ${node.stats.good}</span>` : ''}
                            ${node.stats.warning > 0 ? `<span class="badge bg-warning" style="font-size: 0.75rem;" title="${node.stats.warning} warnings"><i class="fas fa-exclamation-triangle"></i> ${node.stats.warning}</span>` : ''}
                            ${node.stats.error > 0 ? `<span class="badge bg-danger" style="font-size: 0.75rem;" title="${node.stats.error} errors"><i class="fas fa-times"></i> ${node.stats.error}</span>` : ''}
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

        // Rebuild tree structure from updated results
        this.currentTree = this.buildUrlTree(this.currentResults);

        const treeView = document.getElementById('treeViewContainer');
        const isTreeViewActive = treeView && !treeView.classList.contains('hidden');

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
        this.updateTabCounts();
        this.renderResults();

        // If tree view is active, refresh it to show updated statuses
        if (isTreeViewActive && this.currentTree) {
            this.renderTreeView();
        }
    }

    updateTabCounts() {
        if (!this.currentResults) return;

        // Count items for "All Items" view (respects filters including hide done)
        const allItemsCount = this.filteredResults.length;

        // Count items needing attention (warning or error, regardless of review status)
        const needsAttentionCount = this.currentResults.filter(r =>
            r.status === 'warning' || r.status === 'error' || r.status === 'needs_attention'
        ).length;

        // Count items marked as in progress
        const inProgressCount = this.currentResults.filter(r =>
            r.reviewStatus === 'in_progress'
        ).length;

        // Update badges
        const allBadge = document.getElementById('allItemsCount');
        const needsAttentionBadge = document.getElementById('needsAttentionCount');
        const inProgressBadge = document.getElementById('inProgressCount');

        if (allBadge) allBadge.textContent = allItemsCount;
        if (needsAttentionBadge) needsAttentionBadge.textContent = needsAttentionCount;
        if (inProgressBadge) inProgressBadge.textContent = inProgressCount;
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

        return `
            <div class="url-item-v2 ${statusClass}" data-url="${result.url}" onclick="app.openUrlDetails('${result.url}')" style="cursor: pointer;">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1" style="min-width: 0; overflow-wrap: break-word;">
                        <div class="d-flex align-items-center gap-2 mb-1">
                            <strong style="overflow-wrap: break-word; word-break: break-word;">${result.title || result.url}</strong>
                        </div>
                        <div class="text-muted small mb-1" style="overflow-wrap: break-word; word-break: break-word;">
                            ${result.url}
                        </div>
                        <div class="meta-description-preview" style="overflow-wrap: break-word; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            ${result.metaDescription || '<em>No meta description</em>'}
                            <span class="text-muted">(${charCount} chars)</span>
                        </div>
                    </div>
                    <div class="d-flex flex-column gap-1 align-items-end" style="flex-shrink: 0; margin-left: 10px;">
                        <span class="badge bg-${statusClass}">${result.status}</span>
                        <span class="badge bg-${(result.reviewStatus || 'new') === 'reviewed' ? 'success' : 'secondary'}">${(result.reviewStatus || 'new') === 'reviewed' ? '<i class="fas fa-check"></i> ' : ''}${result.reviewStatus || 'new'}</span>
                        ${result.hasChanged ? `<span class="badge bg-info"><i class="fas fa-history"></i> Changed</span>` : ''}
                        ${result.changeType === 'new' ? `<span class="badge bg-success"><i class="fas fa-plus"></i> New</span>` : ''}
                        ${result.issues && result.issues.length > 0 ? `<span class="badge bg-danger">${result.issues.length} issue${result.issues.length > 1 ? 's' : ''}</span>` : ''}
                    </div>
                </div>
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

    updateMetaCharCount() {
        const textarea = document.getElementById('modalMetaDescription');
        const countSpan = document.getElementById('metaCharCount');

        if (!textarea || !countSpan) return;

        const charCount = textarea.value.length;
        const isOptimal = charCount >= 120 && charCount <= 160;
        const hasContent = charCount > 0;

        // Update count and color
        let colorClass = 'text-danger';
        if (isOptimal) {
            colorClass = 'text-success';
        } else if (hasContent) {
            colorClass = 'text-warning';
        }

        // Remove old color classes
        countSpan.classList.remove('text-success', 'text-warning', 'text-danger');
        countSpan.classList.add(colorClass);

        // Update text
        countSpan.textContent = `(${charCount} chars - Optimal: 120-160)`;
    }

    updateTitleCharCount() {
        const textarea = document.getElementById('modalTitle');
        const countSpan = document.getElementById('titleCharCount');

        if (!textarea || !countSpan) return;

        const charCount = textarea.value.length;
        const isOptimal = charCount >= 50 && charCount <= 60;
        const hasContent = charCount > 0;

        // Update count and color
        let colorClass = 'text-muted';
        if (isOptimal) {
            colorClass = 'text-success';
        } else if (!hasContent) {
            colorClass = 'text-danger';
        }

        // Remove old color classes
        countSpan.classList.remove('text-success', 'text-muted', 'text-danger');
        countSpan.classList.add(colorClass);

        // Update text
        countSpan.textContent = `${charCount} characters ${isOptimal ? '✓' : '(Optimal: 50-60)'}`;
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

    // AI Methods

    async generateAISuggestions(url, title, currentMeta) {
        // First, show prompt preview modal
        const promptModal = new bootstrap.Modal(document.getElementById('aiPromptPreviewModal'));
        promptModal.show();

        // Show loading state while building prompt
        document.getElementById('promptLoading').classList.remove('hidden');
        document.getElementById('promptContent').classList.add('hidden');

        try {
            // Build the prompt first
            const response = await fetch('/api/ai/build-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    title: title || '',
                    currentMeta: currentMeta || ''
                })
            });

            const data = await response.json();

            if (data.success) {
                // Hide loading, show prompt editor
                document.getElementById('promptLoading').classList.add('hidden');
                document.getElementById('promptContent').classList.remove('hidden');

                // Fill in the prompt textarea
                document.getElementById('aiPromptText').value = data.prompt;

                // Store data for later use
                window.currentAIPromptData = { url, currentMeta };
            } else {
                throw new Error(data.error || 'Failed to build prompt');
            }
        } catch (error) {
            document.getElementById('promptLoading').classList.add('hidden');
            alert('Error building prompt: ' + error.message);
            promptModal.hide();
        }
    }

    async sendPromptToAI() {
        const prompt = document.getElementById('aiPromptText').value;
        const provider = document.getElementById('aiProviderSelect').value;

        if (!prompt.trim()) {
            alert('Please enter a prompt');
            return;
        }

        // Close prompt modal
        const promptModal = bootstrap.Modal.getInstance(document.getElementById('aiPromptPreviewModal'));
        promptModal.hide();

        // Open AI suggestions modal
        const suggestionsModal = new bootstrap.Modal(document.getElementById('aiSuggestionsModal'));
        suggestionsModal.show();

        // Show loading state
        document.getElementById('aiLoadingState').classList.remove('hidden');
        document.getElementById('aiSuggestionsContent').classList.add('hidden');
        document.getElementById('aiErrorState').classList.add('hidden');

        try {
            const response = await fetch('/api/ai/generate-meta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    count: 4,
                    provider
                })
            });

            const data = await response.json();

            if (data.success) {
                this.displayAISuggestions(data, window.currentAIPromptData.url, window.currentAIPromptData.currentMeta);
            } else {
                throw new Error(data.error || 'Failed to generate suggestions');
            }
        } catch (error) {
            document.getElementById('aiLoadingState').classList.add('hidden');
            document.getElementById('aiErrorState').classList.remove('hidden');
            document.getElementById('aiErrorMessage').textContent = error.message;
        }
    }

    displayAISuggestions(data, url, currentMeta) {
        // Hide loading, show content
        document.getElementById('aiLoadingState').classList.add('hidden');
        document.getElementById('aiSuggestionsContent').classList.remove('hidden');

        // Show current meta
        document.getElementById('aiCurrentMeta').textContent = currentMeta || 'No meta description';
        document.getElementById('aiCurrentLength').textContent = (currentMeta || '').length;

        // Show suggestions
        const suggestionsList = document.getElementById('aiSuggestionsList');
        suggestionsList.innerHTML = '';

        data.suggestions.forEach((suggestion, index) => {
            const optimalBadge = suggestion.isOptimal ?
                '<span class="badge bg-success ms-2">Optimal Length</span>' : '';

            const suggestionHTML = `
                <div class="card mb-3">
                    <div class="card-body">
                        <h6>
                            Suggestion #${index + 1}
                            ${optimalBadge}
                            <span class="badge bg-secondary ms-2">${suggestion.length} chars</span>
                        </h6>
                        <p class="mb-3">${suggestion.text}</p>
                        <div class="d-flex gap-2">
                            <button class="btn btn-sm btn-primary" onclick="app.copyToClipboard('${suggestion.text.replace(/'/g, "\\'")}', this)">
                                <i class="fas fa-copy"></i> Copy
                            </button>
                            <button class="btn btn-sm btn-success" onclick="app.useSuggestion('${url}', '${suggestion.text.replace(/'/g, "\\'")}', '${(currentMeta || '').replace(/'/g, "\\'")}')">
                                <i class="fas fa-check"></i> Use This
                            </button>
                        </div>
                    </div>
                </div>
            `;
            suggestionsList.innerHTML += suggestionHTML;
        });

        // Show cost info
        const cost = data.usage.estimatedCost.toFixed(6);
        const tokens = data.usage.inputTokens + data.usage.outputTokens;
        document.getElementById('aiCost').textContent = cost;
        document.getElementById('aiTokens').textContent = tokens;

        // Update session tracking
        this.updateSessionAICost(data.usage.estimatedCost);
    }

    loadAICostTracking() {
        try {
            const saved = localStorage.getItem('aiCostTracking');
            if (saved) {
                const data = JSON.parse(saved);
                this.sessionAICost = data.cost || 0;
                this.sessionAIRequests = data.requests || 0;

                // Update display if there's existing data
                if (this.sessionAICost > 0) {
                    document.getElementById('sessionAICost').textContent = this.sessionAICost.toFixed(4);
                    document.getElementById('sessionAIRequests').textContent = this.sessionAIRequests;
                    const tracker = document.getElementById('aiCostTracker');
                    if (tracker) tracker.style.display = 'block';
                }
            } else {
                this.sessionAICost = 0;
                this.sessionAIRequests = 0;
            }
        } catch (e) {
            console.error('Error loading AI cost tracking:', e);
            this.sessionAICost = 0;
            this.sessionAIRequests = 0;
        }
    }

    saveAICostTracking() {
        try {
            localStorage.setItem('aiCostTracking', JSON.stringify({
                cost: this.sessionAICost,
                requests: this.sessionAIRequests,
                lastUpdated: new Date().toISOString()
            }));
        } catch (e) {
            console.error('Error saving AI cost tracking:', e);
        }
    }

    updateSessionAICost(cost) {
        this.sessionAICost += cost;
        this.sessionAIRequests += 1;

        // Update display
        document.getElementById('sessionAICost').textContent = this.sessionAICost.toFixed(4);
        document.getElementById('sessionAIRequests').textContent = this.sessionAIRequests;

        // Show the tracker if hidden
        const tracker = document.getElementById('aiCostTracker');
        if (tracker) {
            tracker.style.display = 'block';
        }

        // Save to localStorage
        this.saveAICostTracking();
    }

    resetAICostTracking() {
        if (!confirm('Reset AI cost tracking? This will clear your session total.')) {
            return;
        }

        this.sessionAICost = 0;
        this.sessionAIRequests = 0;

        // Update display
        document.getElementById('sessionAICost').textContent = '0.00';
        document.getElementById('sessionAIRequests').textContent = '0';

        // Hide the tracker
        const tracker = document.getElementById('aiCostTracker');
        if (tracker) {
            tracker.style.display = 'none';
        }

        // Clear from localStorage
        localStorage.removeItem('aiCostTracking');

        this.showNotification('AI cost tracking reset', 'info');
    }

    useSuggestion(url, suggestion, originalMeta = '') {
        const metaField = document.getElementById('modalMetaDescription');
        const metaContainer = metaField.parentElement;

        // Hide the original meta description field
        metaContainer.style.display = 'none';

        // Create a comparison section if it doesn't exist
        let comparisonSection = document.getElementById('metaComparisonSection');
        if (!comparisonSection) {
            // Create new comparison section
            comparisonSection = document.createElement('div');
            comparisonSection.id = 'metaComparisonSection';
            comparisonSection.className = 'mb-3';

            // Insert after the meta description field container
            metaContainer.parentNode.insertBefore(comparisonSection, metaContainer.nextSibling);
        }

        // Build comparison HTML
        const originalCharClass = originalMeta.length >= 120 && originalMeta.length <= 160 ? 'text-success' : 'text-warning';
        const suggestionCharClass = suggestion.length >= 120 && suggestion.length <= 160 ? 'text-success' : 'text-warning';

        comparisonSection.innerHTML = `
            <h6 class="mb-3">
                <i class="fas fa-exchange-alt"></i> Meta Description Comparison
                <button class="btn btn-sm btn-outline-secondary ms-2" onclick="app.clearComparison()">
                    <i class="fas fa-times"></i> Clear
                </button>
            </h6>

            ${originalMeta && originalMeta.trim() ? `
            <div class="mb-3">
                <label class="form-label">
                    Original
                    <span id="originalCharCount" class="${originalCharClass}">(${originalMeta.length} chars)</span>
                </label>
                <textarea class="form-control" rows="3" id="originalMetaField" oninput="app.updateComparisonCharCount('original')">${originalMeta}</textarea>
                <button class="btn btn-sm btn-outline-primary mt-2" onclick="app.copyToClipboard(document.getElementById('originalMetaField').value, this)">
                    <i class="fas fa-copy"></i> Copy Original
                </button>
            </div>
            ` : ''}

            <div>
                <label class="form-label">
                    AI Suggestion
                    <span id="suggestionCharCount" class="${suggestionCharClass}">(${suggestion.length} chars)</span>
                </label>
                <textarea class="form-control" rows="3" id="suggestionMetaField" oninput="app.updateComparisonCharCount('suggestion')">${suggestion}</textarea>
                <div class="d-flex gap-2 mt-2">
                    <button class="btn btn-sm btn-success" onclick="app.copyToClipboard(document.getElementById('suggestionMetaField').value, this)">
                        <i class="fas fa-copy"></i> Copy AI Suggestion
                    </button>
                </div>
            </div>
        `;

        // Copy suggestion to clipboard
        navigator.clipboard.writeText(suggestion);

        // Show notification
        this.showNotification(`AI suggestion applied! Original and suggestion shown for comparison.`, 'success');

        // Close AI modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('aiSuggestionsModal'));
        if (modal) modal.hide();
    }

    clearComparison() {
        // Remove comparison section
        const comparisonSection = document.getElementById('metaComparisonSection');
        if (comparisonSection) {
            comparisonSection.remove();
        }

        // Show the original meta description field again
        const metaField = document.getElementById('modalMetaDescription');
        if (metaField) {
            const metaContainer = metaField.parentElement;
            metaContainer.style.display = '';
        }
    }

    updateComparisonCharCount(type) {
        const fieldId = type === 'original' ? 'originalMetaField' : 'suggestionMetaField';
        const countId = type === 'original' ? 'originalCharCount' : 'suggestionCharCount';

        const field = document.getElementById(fieldId);
        const countSpan = document.getElementById(countId);

        if (!field || !countSpan) return;

        const length = field.value.length;
        const isOptimal = length >= 120 && length <= 160;

        countSpan.textContent = `(${length} chars)`;
        countSpan.className = isOptimal ? 'text-success' : 'text-warning';
    }

    handleReviewStatusClick(url, clickedStatus, buttonGroup) {
        // Get current status from data
        const result = this.currentResults.find(r => r.url === url);
        if (!result) return;

        // Toggle: if clicking same status, reset to 'new'
        const newStatus = result.reviewStatus === clickedStatus ? 'new' : clickedStatus;

        // Update button states immediately
        this.updateReviewStatusButtons(buttonGroup, newStatus);

        // Update on server
        this.updateReviewStatus(url, newStatus);
    }

    updateReviewStatusButtons(buttonGroup, activeStatus) {
        const buttons = buttonGroup.querySelectorAll('.review-status-btn');
        buttons.forEach(btn => {
            const status = btn.dataset.status;
            const isActive = status === activeStatus;

            // Remove all active classes
            btn.classList.remove('btn-secondary', 'btn-warning', 'btn-success', 'active');
            btn.classList.remove('btn-outline-secondary', 'btn-outline-warning', 'btn-outline-success');

            // Add appropriate classes
            if (isActive) {
                btn.classList.add('active');
                if (status === 'new') btn.classList.add('btn-secondary');
                else if (status === 'in_progress') btn.classList.add('btn-warning');
                else if (status === 'reviewed') btn.classList.add('btn-success');
            } else {
                if (status === 'new') btn.classList.add('btn-outline-secondary');
                else if (status === 'in_progress') btn.classList.add('btn-outline-warning');
                else if (status === 'reviewed') btn.classList.add('btn-outline-success');
            }
        });
    }

    async updateReviewStatus(url, newStatus) {
        try {
            const response = await fetch('/api/reviews/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, status: newStatus })
            });

            if (!response.ok) {
                throw new Error('Failed to update review status');
            }

            // Update local data
            const result = this.currentResults.find(r => r.url === url);
            if (result) {
                result.reviewStatus = newStatus;
            }

            // Re-render current view to show updated status
            this.applyFilters();
            this.renderStats(); // Update stats cards

            this.showNotification(`Marked as ${newStatus.replace('_', ' ')}`, 'success');
        } catch (error) {
            this.showError('Failed to update review status: ' + error.message);
        }
    }

    async viewChangeHistory(url) {
        const sitemapUrl = document.getElementById('sitemapUrl').value;
        if (!sitemapUrl) {
            this.showError('Sitemap URL not found');
            return;
        }

        try {
            const response = await fetch(`/api/change-history?sitemapUrl=${encodeURIComponent(sitemapUrl)}&url=${encodeURIComponent(url)}`);
            const history = await response.json();

            const content = document.getElementById('changeHistoryContent');

            if (history.length === 0) {
                content.innerHTML = '<p class="text-muted">No change history found for this URL.</p>';
            } else {
                content.innerHTML = `
                    <div class="mb-3">
                        <strong>URL:</strong> <a href="${url}" target="_blank">${url}</a>
                    </div>
                    <div class="timeline">
                        ${history.reverse().map(change => {
                            const date = new Date(change.timestamp).toLocaleString();
                            const changeIcon = change.changeType === 'new_url' ? 'plus' :
                                              change.changeType === 'meta_description' ? 'edit' : 'heading';
                            return `
                                <div class="timeline-item mb-4 p-3" style="border-left: 4px solid #667eea; background: var(--bg-primary); border-radius: 5px;">
                                    <div class="d-flex justify-content-between mb-2">
                                        <span class="badge bg-secondary">
                                            <i class="fas fa-${changeIcon}"></i> ${change.changeType.replace('_', ' ')}
                                        </span>
                                        <small class="text-muted">${date}</small>
                                    </div>
                                    ${change.oldValue ? `
                                        <div class="mb-2">
                                            <strong class="text-danger">Old:</strong><br/>
                                            <span style="background: rgba(220, 53, 69, 0.1); padding: 5px; border-radius: 3px;">${change.oldValue}</span>
                                        </div>
                                    ` : ''}
                                    ${change.newValue ? `
                                        <div>
                                            <strong class="text-success">New:</strong><br/>
                                            <span style="background: rgba(40, 167, 69, 0.1); padding: 5px; border-radius: 3px;">${change.newValue}</span>
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }

            const modal = new bootstrap.Modal(document.getElementById('changeHistoryModal'));
            modal.show();
        } catch (error) {
            this.showError('Failed to load change history: ' + error.message);
        }
    }

    async rescanUrl(url, keepModalOpen = false) {
        const sitemapUrl = document.getElementById('sitemapUrl').value;
        if (!sitemapUrl) {
            this.showError('Sitemap URL not found');
            return;
        }

        // Find all rescan buttons including the modal one
        const modalBtn = document.getElementById('modalRescanBtn');
        const buttons = document.querySelectorAll(`[onclick*="rescanUrl('${url}')"]`);
        const allButtons = modalBtn ? [modalBtn, ...Array.from(buttons)] : Array.from(buttons);
        const originalButtonHTML = allButtons.length > 0 ? allButtons[0].innerHTML : '<i class="fas fa-sync"></i> Rescan Page';

        allButtons.forEach(btn => {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rescanning...';
        });

        // Check if modal is open
        const modalElement = document.getElementById('urlDetailsModal');
        const isModalOpen = modalElement && modalElement.classList.contains('show');

        try {
            const response = await fetch('/api/rescan-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, sitemapUrl })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || 'Failed to rescan URL');
            }

            const data = await response.json();

            // Update the local results - preserve existing properties like reviewStatus
            const index = this.currentResults.findIndex(r => r.url === url);
            if (index !== -1) {
                const oldResult = this.currentResults[index];
                this.currentResults[index] = {
                    ...oldResult,
                    ...data.result,
                    // Preserve review status and other local-only properties
                    reviewStatus: oldResult.reviewStatus,
                    assignee: oldResult.assignee,
                    notes: oldResult.notes
                };
            }

            // Re-render the current view
            this.applyFilters();
            this.renderStats(); // Update stats cards after rescan

            // Reload modal content if modal is open
            if (isModalOpen) {
                const updatedResult = this.currentResults.find(r => r.url === url);
                if (updatedResult) {
                    // Update modal content directly without creating new modal instance
                    this.updateModalContent(url);
                }
            }

            // Restore button state
            allButtons.forEach(btn => {
                btn.disabled = false;
                btn.innerHTML = originalButtonHTML;
            });

            if (data.hasChanges) {
                this.showNotification('URL rescanned - Changes detected!', 'info');
            } else {
                this.showNotification('URL rescanned - No changes detected', 'success');
            }
        } catch (error) {
            console.error('Rescan error:', error);
            this.showError('Failed to rescan URL: ' + error.message);

            // Restore button state on error
            allButtons.forEach(btn => {
                btn.disabled = false;
                btn.innerHTML = originalButtonHTML;
            });
        }
    }

    async showBulkAIModal() {
        if (!this.currentResults) {
            this.showError('Please run a scan first');
            return;
        }

        // Count URLs with issues
        const urlsWithIssues = this.currentResults.filter(r =>
            r.status === 'error' || r.status === 'warning'
        );

        if (urlsWithIssues.length === 0) {
            this.showNotification('No URLs with issues found!', 'info');
            return;
        }

        document.getElementById('bulkAICount').textContent = urlsWithIssues.length;

        // Calculate estimated cost
        const avgCost = 0.004; // $0.004 per URL
        const estimatedCost = (urlsWithIssues.length * avgCost).toFixed(2);
        document.getElementById('bulkAIEstimatedCost').textContent = estimatedCost;

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('bulkAIModal'));
        modal.show();

        // Set up start button
        document.getElementById('startBulkAIBtn').onclick = () => this.startBulkAI(urlsWithIssues);
    }

    async startBulkAI(urls) {
        const suggestionsCount = parseInt(document.getElementById('bulkAISuggestionsCount').value);

        // Hide start button, show progress
        document.getElementById('startBulkAIBtn').disabled = true;
        document.getElementById('bulkAIProgress').classList.remove('hidden');
        document.getElementById('bulkAIResults').classList.add('hidden');

        const pages = urls.map(url => ({
            url: url.url,
            title: url.title || '',
            currentMeta: url.metaDescription || ''
        }));

        try {
            const response = await fetch('/api/ai/bulk-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pages,
                    suggestionsPerPage: suggestionsCount
                })
            });

            const data = await response.json();

            if (data.success) {
                this.displayBulkAIResults(data);
            } else {
                throw new Error(data.error || 'Failed to generate bulk suggestions');
            }
        } catch (error) {
            this.showError('Bulk AI failed: ' + error.message);
        } finally {
            document.getElementById('startBulkAIBtn').disabled = false;
            document.getElementById('bulkAIProgress').classList.add('hidden');
        }
    }

    displayBulkAIResults(data) {
        document.getElementById('bulkAIResults').classList.remove('hidden');

        const resultsList = document.getElementById('bulkAIResultsList');
        resultsList.innerHTML = `
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                <strong>Success!</strong> Generated suggestions for ${data.totalProcessed} URLs.
                <br>
                <strong>Total Cost:</strong> $${data.totalCost.toFixed(4)}
            </div>
            <p>The AI has generated suggestions. Review the URLs in the main results list to see individual suggestions.</p>
        `;

        this.showNotification(`Bulk AI complete! Generated suggestions for ${data.totalProcessed} URLs`, 'success');
    }

    async detectMboSession() {
        const button = document.getElementById('detectMboBtn');
        const statusIndicator = document.getElementById('mboStatusIndicator');
        const statusText = document.getElementById('mboStatus');
        const buttonText = document.getElementById('mboStatusText');
        const sitemapUrl = document.getElementById('sitemapUrl').value;

        if (!sitemapUrl) {
            this.showError('Please enter a sitemap URL first');
            return;
        }

        // Extract base URL from sitemap
        let baseUrl;
        try {
            const urlObj = new URL(sitemapUrl);
            baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        } catch (e) {
            this.showError('Invalid sitemap URL');
            return;
        }

        button.disabled = true;
        buttonText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting...';

        try {
            const response = await fetch('/api/detect-mbo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseUrl })
            });

            const data = await response.json();

            if (response.ok && data.hasSession) {
                statusIndicator.style.display = 'block';
                statusText.innerHTML = `<span class="text-success"><i class="fas fa-check-circle"></i> Detected (Token: ${data.token.substring(0, 8)}...)</span>`;
                buttonText.textContent = 'MBO Session Active';
                button.classList.remove('btn-outline-info');
                button.classList.add('btn-success');
                this.showNotification('MBO session detected successfully!', 'success');

                // Store session info for use during scans
                this.mboSession = {
                    token: data.token,
                    sessionType: data.sessionType,
                    detectedAt: data.detectedAt
                };

                // Save to localStorage
                try {
                    localStorage.setItem('mboSession', JSON.stringify(this.mboSession));
                    console.log('✓ MBO session saved to localStorage');
                } catch (e) {
                    console.error('Error saving MBO session:', e);
                }
            } else {
                statusIndicator.style.display = 'block';
                statusText.innerHTML = '<span class="text-warning"><i class="fas fa-exclamation-triangle"></i> Not detected - Make sure you\'re logged into ePages MBO</span>';
                buttonText.textContent = 'Retry Detection';
                this.showNotification('MBO session not detected. Make sure you have an active ePages MBO session.', 'warning');
            }
        } catch (error) {
            console.error('MBO detection error:', error);
            statusIndicator.style.display = 'block';
            statusText.innerHTML = `<span class="text-danger"><i class="fas fa-times-circle"></i> Error: ${error.message}</span>`;
            buttonText.textContent = 'Retry Detection';
            this.showError('Failed to detect MBO session: ' + error.message);
        } finally {
            button.disabled = false;
        }
    }

    toggleManualMboEntry() {
        const manualEntry = document.getElementById('mboManualEntry');
        if (manualEntry.style.display === 'none') {
            manualEntry.style.display = 'block';
        } else {
            manualEntry.style.display = 'none';
        }
    }

    saveManualMboToken() {
        const tokenInput = document.getElementById('mboTokenInput');
        const token = tokenInput.value.trim();

        if (!token) {
            this.showError('Please enter a token');
            return;
        }

        // Validate token format (alphanumeric)
        if (!/^[a-z0-9]+$/i.test(token)) {
            this.showError('Invalid token format. Token should only contain letters and numbers.');
            return;
        }

        const statusIndicator = document.getElementById('mboStatusIndicator');
        const statusText = document.getElementById('mboStatus');
        const mboButton = document.getElementById('manualMboBtn');
        const buttonText = document.getElementById('mboButtonText');

        // Store the token
        this.mboSession = {
            token: token,
            sessionType: 'manual',
            detectedAt: new Date().toISOString()
        };

        // Save to localStorage
        try {
            localStorage.setItem('mboSession', JSON.stringify(this.mboSession));
            console.log('✓ MBO session saved to localStorage');
        } catch (e) {
            console.error('Error saving MBO session:', e);
        }

        // Update UI
        statusIndicator.style.display = 'block';
        statusText.innerHTML = `<span class="text-success"><i class="fas fa-check-circle"></i> Token set manually (${token.substring(0, 8)}...)</span>`;
        buttonText.textContent = 'MBO Token Active';
        mboButton.classList.remove('btn-outline-info');
        mboButton.classList.add('btn-success');

        // Hide manual entry
        document.getElementById('mboManualEntry').style.display = 'none';

        this.showNotification('MBO token saved! It will persist across page refreshes.', 'success');

        // Refresh the results display to update MBO buttons
        if (this.currentResults) {
            this.renderResults(this.filteredResults || this.currentResults);
        }
    }

    clearMboSession() {
        if (!confirm('Are you sure you want to clear the saved MBO token? You will need to enter it again.')) {
            return;
        }

        // Clear from memory
        this.mboSession = null;

        // Clear from localStorage
        try {
            localStorage.removeItem('mboSession');
            console.log('✓ MBO session cleared from localStorage');
        } catch (e) {
            console.error('Error clearing MBO session:', e);
        }

        // Reset UI
        const statusIndicator = document.getElementById('mboStatusIndicator');
        const statusText = document.getElementById('mboStatus');
        const mboButton = document.getElementById('manualMboBtn');
        const buttonText = document.getElementById('mboButtonText');
        const tokenInput = document.getElementById('mboTokenInput');

        statusIndicator.style.display = 'none';
        statusText.innerHTML = 'Not detected';
        buttonText.textContent = 'Set MBO Token';
        mboButton.classList.remove('btn-success');
        mboButton.classList.add('btn-outline-info');

        if (tokenInput) {
            tokenInput.value = '';
        }

        this.showNotification('MBO token cleared. Enter a new token when your session changes.', 'info');

        // Refresh the results display to update MBO buttons
        if (this.currentResults) {
            this.renderResults(this.filteredResults || this.currentResults);
        }
    }

    generateMboButton(result) {
        // Check if we have an object ID for this page
        if (!result.dataLayer?.objectId) {
            console.log('No MBO button - missing objectId:', result.url, result.dataLayer);
            return ''; // No object ID, no button
        }

        const objectId = result.dataLayer.objectId;
        console.log('Generating MBO button for:', result.url, 'ObjectID:', objectId);

        // If we have an MBO token, generate the URL
        if (this.mboSession && this.mboSession.token) {
            const urlObj = new URL(result.url);
            const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
            const shopId = 'yxve46fvrnud'; // This should match the shop ID in webCrawler.js
            const mboUrl = `${baseUrl}/epages/${shopId}.admin/sec${this.mboSession.token}/?ObjectID=${objectId}`;

            return `
                <a href="${mboUrl}" target="_blank" class="btn btn-sm" style="color: #fff; background-color: #d41118; border-color: #d41118;" title="Edit in MBO">
                    <i class="fas fa-external-link-alt"></i> Edit in MBO
                </a>
            `;
        }

        // No token set - show a hint to set one
        return `
            <button class="btn btn-sm btn-outline-secondary" disabled title="Set MBO token to enable">
                <i class="fas fa-lock"></i> Set Token First
            </button>
        `;
    }

    openUrlDetails(url) {
        // Find the result data
        const result = this.currentResults.find(r => r.url === url);
        if (!result) {
            this.showError('URL data not found');
            return;
        }

        // Update modal title
        document.getElementById('modalPageTitle').textContent = result.title || url;

        // Generate SEO recommendations
        const seoSuggestions = this.generateSeoSuggestions(result);

        // Build modal content
        const charCount = result.characterCount || 0;
        const charCountClass = charCount >= 120 && charCount <= 160 ? 'text-success' :
                               charCount > 0 ? 'text-warning' : 'text-danger';

        const modalContent = `
            <div class="row">
                <!-- Left Column: Details -->
                <div class="col-md-7">
                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-link"></i> URL Details</h6>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Page URL</label>
                            <div class="input-group">
                                <input type="text" class="form-control" value="${result.url}" readonly>
                                <a href="${result.url}" target="_blank" class="btn btn-outline-secondary">
                                    <i class="fas fa-external-link-alt"></i> Visit
                                </a>
                            </div>
                        </div>

                        <div class="mb-3">
                            <label class="form-label fw-bold">Page Title</label>
                            <textarea class="form-control" rows="2" id="modalTitle" oninput="app.updateTitleCharCount()">${result.title || ''}</textarea>
                            <small id="titleCharCount" class="text-muted">${(result.title || '').length} characters (Optimal: 50-60)</small>
                        </div>

                        <div class="mb-3">
                            <label class="form-label fw-bold">
                                Meta Description
                                <span id="metaCharCount" class="${charCountClass}">(${charCount} chars - Optimal: 120-160)</span>
                            </label>
                            <textarea class="form-control" rows="3" id="modalMetaDescription" oninput="app.updateMetaCharCount()">${result.metaDescription || ''}</textarea>
                            <div class="d-flex gap-2 mt-2">
                                <button class="btn btn-sm btn-outline-primary" onclick="app.copyToClipboard(document.getElementById('modalMetaDescription').value, this)">
                                    <i class="fas fa-copy"></i> Copy
                                </button>
                                <button class="btn btn-sm btn-purple" onclick="app.generateAISuggestions('${result.url}', document.getElementById('modalTitle').value, document.getElementById('modalMetaDescription').value)">
                                    <i class="fas fa-robot"></i> AI Suggestions
                                </button>
                            </div>
                        </div>

                        ${result.issues && result.issues.length > 0 ? `
                            <div class="mb-3">
                                <label class="form-label fw-bold text-danger">
                                    <i class="fas fa-exclamation-triangle"></i> Issues Found (${result.issues.length})
                                </label>
                                <ul class="list-group">
                                    ${result.issues.map(issue => `<li class="list-group-item list-group-item-danger">${issue}</li>`).join('')}
                                </ul>
                            </div>
                        ` : '<div class="alert alert-success"><i class="fas fa-check-circle"></i> No issues found</div>'}
                    </div>
                </div>

                <!-- Right Column: Actions & SEO Tips -->
                <div class="col-md-5">
                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-tasks"></i> Quick Actions</h6>
                        <div class="d-grid gap-2">
                            <button class="btn btn-outline-primary" id="modalRescanBtn" onclick="app.rescanUrl('${result.url}', true);">
                                <i class="fas fa-sync"></i> Rescan Page
                            </button>
                            ${this.generateMboButton(result)}
                            ${result.hasChanged ? `
                                <button class="btn btn-outline-info" onclick="app.viewChangeHistory('${result.url}')">
                                    <i class="fas fa-history"></i> View Change History
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-flag"></i> Review Status</h6>
                        <div class="btn-group d-flex review-status-buttons" role="group" data-url="${result.url}">
                            <button class="btn review-status-btn ${(result.reviewStatus || 'new') === 'new' ? 'btn-secondary active' : 'btn-outline-secondary'}" data-status="new">
                                New
                            </button>
                            <button class="btn review-status-btn ${(result.reviewStatus || 'new') === 'in_progress' ? 'btn-warning active' : 'btn-outline-warning'}" data-status="in_progress">
                                In Progress
                            </button>
                            <button class="btn review-status-btn ${(result.reviewStatus || 'new') === 'reviewed' ? 'btn-success active' : 'btn-outline-success'}" data-status="reviewed">
                                Reviewed
                            </button>
                        </div>
                    </div>

                    ${seoSuggestions ? `
                        <div class="mb-4">
                            <h6 class="border-bottom pb-2"><i class="fas fa-lightbulb"></i> SEO Suggestions</h6>
                            <div class="alert alert-info">
                                ${seoSuggestions}
                            </div>
                        </div>
                    ` : ''}

                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-info-circle"></i> Page Stats</h6>
                        <ul class="list-group list-group-flush">
                            <li class="list-group-item d-flex justify-content-between">
                                <span>Status:</span>
                                <span class="badge bg-${result.status || 'warning'}">${result.status || 'warning'}</span>
                            </li>
                            <li class="list-group-item d-flex justify-content-between">
                                <span>Last Analyzed:</span>
                                <span class="text-muted small">${result.lastAnalyzed ? new Date(result.lastAnalyzed).toLocaleString() : 'N/A'}</span>
                            </li>
                            ${result.hasChanged ? `
                                <li class="list-group-item d-flex justify-content-between">
                                    <span>Status:</span>
                                    <span class="badge bg-info"><i class="fas fa-history"></i> Changed</span>
                                </li>
                            ` : ''}
                        </ul>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('urlDetailsContent').innerHTML = modalContent;

        // Show the modal without backdrop
        const modal = new bootstrap.Modal(document.getElementById('urlDetailsModal'), {
            backdrop: false,
            keyboard: true
        });
        modal.show();

        // Store current URL for saving changes
        this.currentModalUrl = url;
    }

    updateModalContent(url) {
        // Update only the modal content without creating a new modal instance
        const result = this.currentResults.find(r => r.url === url);
        if (!result) return;

        // Update modal title
        document.getElementById('modalPageTitle').textContent = result.title || url;

        // Generate and update content
        const seoSuggestions = this.generateSeoSuggestions(result);
        const charCount = result.characterCount || 0;
        const charCountClass = charCount >= 120 && charCount <= 160 ? 'text-success' :
                               charCount > 0 ? 'text-warning' : 'text-danger';

        const modalContent = `
            <div class="row">
                <!-- Left Column: Details -->
                <div class="col-md-7">
                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-link"></i> URL Details</h6>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Page URL</label>
                            <div class="input-group">
                                <input type="text" class="form-control" value="${result.url}" readonly>
                                <a href="${result.url}" target="_blank" class="btn btn-outline-secondary">
                                    <i class="fas fa-external-link-alt"></i> Visit
                                </a>
                            </div>
                        </div>

                        <div class="mb-3">
                            <label class="form-label fw-bold">Page Title</label>
                            <textarea class="form-control" rows="2" id="modalTitle" oninput="app.updateTitleCharCount()">${result.title || ''}</textarea>
                            <small id="titleCharCount" class="text-muted">${(result.title || '').length} characters (Optimal: 50-60)</small>
                        </div>

                        <div class="mb-3">
                            <label class="form-label fw-bold">
                                Meta Description
                                <span id="metaCharCount" class="${charCountClass}">(${charCount} chars - Optimal: 120-160)</span>
                            </label>
                            <textarea class="form-control" rows="3" id="modalMetaDescription" oninput="app.updateMetaCharCount()">${result.metaDescription || ''}</textarea>
                            <div class="d-flex gap-2 mt-2">
                                <button class="btn btn-sm btn-outline-primary" onclick="app.copyToClipboard(document.getElementById('modalMetaDescription').value, this)">
                                    <i class="fas fa-copy"></i> Copy
                                </button>
                                <button class="btn btn-sm btn-purple" onclick="app.generateAISuggestions('${result.url}', document.getElementById('modalTitle').value, document.getElementById('modalMetaDescription').value)">
                                    <i class="fas fa-robot"></i> AI Suggestions
                                </button>
                            </div>
                        </div>

                        ${result.issues && result.issues.length > 0 ? `
                            <div class="mb-3">
                                <label class="form-label fw-bold text-danger">
                                    <i class="fas fa-exclamation-triangle"></i> Issues Found (${result.issues.length})
                                </label>
                                <ul class="list-group">
                                    ${result.issues.map(issue => `<li class="list-group-item list-group-item-danger">${issue}</li>`).join('')}
                                </ul>
                            </div>
                        ` : '<div class="alert alert-success"><i class="fas fa-check-circle"></i> No issues found</div>'}
                    </div>
                </div>

                <!-- Right Column: Actions & SEO Tips -->
                <div class="col-md-5">
                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-tasks"></i> Quick Actions</h6>
                        <div class="d-grid gap-2">
                            <button class="btn btn-outline-primary" id="modalRescanBtn" onclick="app.rescanUrl('${result.url}', true);">
                                <i class="fas fa-sync"></i> Rescan Page
                            </button>
                            ${this.generateMboButton(result)}
                            ${result.hasChanged ? `
                                <button class="btn btn-outline-info" onclick="app.viewChangeHistory('${result.url}')">
                                    <i class="fas fa-history"></i> View Change History
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-flag"></i> Review Status</h6>
                        <div class="btn-group d-flex review-status-buttons" role="group" data-url="${result.url}">
                            <button class="btn review-status-btn ${(result.reviewStatus || 'new') === 'new' ? 'btn-secondary active' : 'btn-outline-secondary'}" data-status="new">
                                New
                            </button>
                            <button class="btn review-status-btn ${(result.reviewStatus || 'new') === 'in_progress' ? 'btn-warning active' : 'btn-outline-warning'}" data-status="in_progress">
                                In Progress
                            </button>
                            <button class="btn review-status-btn ${(result.reviewStatus || 'new') === 'reviewed' ? 'btn-success active' : 'btn-outline-success'}" data-status="reviewed">
                                Reviewed
                            </button>
                        </div>
                    </div>

                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-lightbulb"></i> SEO Suggestions</h6>
                        <div class="alert alert-info small">
                            ${seoSuggestions}
                        </div>
                    </div>

                    <div class="mb-4">
                        <h6 class="border-bottom pb-2"><i class="fas fa-chart-bar"></i> Page Stats</h6>
                        <ul class="list-group list-group-flush">
                            <li class="list-group-item d-flex justify-content-between">
                                <span>Status:</span>
                                <span class="badge bg-${result.status}">${result.status}</span>
                            </li>
                            <li class="list-group-item d-flex justify-content-between">
                                <span>Last Analyzed:</span>
                                <span class="text-muted small">${result.lastAnalyzed ? new Date(result.lastAnalyzed).toLocaleString() : 'N/A'}</span>
                            </li>
                            ${result.hasChanged ? `
                                <li class="list-group-item d-flex justify-content-between">
                                    <span>Status:</span>
                                    <span class="badge bg-info"><i class="fas fa-history"></i> Changed</span>
                                </li>
                            ` : ''}
                        </ul>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('urlDetailsContent').innerHTML = modalContent;
    }

    generateSeoSuggestions(result) {
        const suggestions = [];
        const charCount = result.characterCount || 0;

        if (!result.metaDescription) {
            suggestions.push('Add a meta description to improve click-through rates from search results.');
        } else if (charCount < 120) {
            suggestions.push('Your meta description is too short. Aim for 120-160 characters for optimal display.');
        } else if (charCount > 160) {
            suggestions.push('Your meta description may be cut off in search results. Consider shortening to 120-160 characters.');
        }

        if (!result.title || result.title.length < 30) {
            suggestions.push('Your page title is too short. Aim for 50-60 characters with relevant keywords.');
        } else if (result.title.length > 60) {
            suggestions.push('Your page title may be truncated in search results. Keep it under 60 characters.');
        }

        if (result.issues && result.issues.length > 0) {
            suggestions.push(`Fix the ${result.issues.length} issue${result.issues.length > 1 ? 's' : ''} detected to improve SEO performance.`);
        }

        if (suggestions.length === 0) {
            return '<i class="fas fa-check-circle text-success"></i> Everything looks good! Keep up the great work.';
        }

        return '<ul class="mb-0">' + suggestions.map(s => `<li>${s}</li>`).join('') + '</ul>';
    }

    async loadSavedScans() {
        try {
            const response = await fetch('/api/saved-scans');
            const data = await response.json();

            if (response.ok && data.scans && data.scans.length > 0) {
                const selector = document.getElementById('savedScanSelector');
                if (!selector) return;

                // Clear existing options except the first one
                selector.innerHTML = '<option value="">-- Select a saved scan --</option>';

                // Add options for each saved scan
                data.scans.forEach(scan => {
                    const option = document.createElement('option');
                    option.value = scan.sitemapUrl || '';

                    // Create a readable label
                    const domain = scan.sitemapUrl ? new URL(scan.sitemapUrl).hostname : 'Unknown';
                    const date = new Date(scan.lastScanned).toLocaleDateString();
                    const time = new Date(scan.lastScanned).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    option.textContent = `${domain} - ${scan.totalUrls} URLs (${date} ${time})`;
                    option.dataset.scanInfo = JSON.stringify(scan);

                    selector.appendChild(option);
                });

                console.log(`Loaded ${data.scans.length} saved scans`);
            }
        } catch (error) {
            console.error('Failed to load saved scans:', error);
        }
    }

    handleSavedScanSelection(event) {
        const selector = event.target;
        const selectedValue = selector.value;

        if (!selectedValue) {
            return;
        }

        // Get the scan info from the selected option
        const selectedOption = selector.options[selector.selectedIndex];
        const scanInfo = JSON.parse(selectedOption.dataset.scanInfo);

        // Set the sitemap URL input
        document.getElementById('sitemapUrl').value = selectedValue;

        // Show a notification with scan info
        this.showNotification(
            `Selected scan: ${scanInfo.totalUrls} URLs (${scanInfo.goodCount} good, ${scanInfo.warningCount} warnings, ${scanInfo.errorCount} errors)`,
            'info'
        );

        // Automatically load the saved results
        this.loadSavedResults();
    }

    async saveUrlChanges() {
        if (!this.currentModalUrl) {
            this.showError('No URL is currently being edited');
            return;
        }

        const button = document.getElementById('saveUrlChanges');
        const originalHTML = button.innerHTML;

        // Get the edited values from the modal
        const newTitle = document.getElementById('modalTitle')?.value;
        const newMetaDescription = document.getElementById('modalMetaDescription')?.value;

        // Show loading state
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        try {
            // Update the local results
            const result = this.currentResults.find(r => r.url === this.currentModalUrl);
            if (result) {
                result.title = newTitle;
                result.metaDescription = newMetaDescription;
                result.characterCount = newMetaDescription ? newMetaDescription.length : 0;

                // Recalculate status based on new character count
                const charCount = result.characterCount;
                if (!newMetaDescription || charCount === 0) {
                    result.status = 'error';
                } else if (charCount >= 120 && charCount <= 160) {
                    result.status = 'good';
                } else {
                    result.status = 'warning';
                }
            }

            // Save to server
            const sitemapUrl = document.getElementById('sitemapUrl').value;
            if (sitemapUrl) {
                const response = await fetch('/api/scan-results/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sitemapUrl,
                        url: this.currentModalUrl,
                        title: newTitle,
                        metaDescription: newMetaDescription
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to save changes');
                }
            }

            // Update the display
            this.applyFilters();
            this.renderStats(); // Update stats cards

            // Show success
            button.innerHTML = '<i class="fas fa-check"></i> Saved!';
            button.classList.remove('btn-primary');
            button.classList.add('btn-success');

            this.showNotification('Changes saved successfully!', 'success');

            // Reset button after 2 seconds
            setTimeout(() => {
                button.disabled = false;
                button.innerHTML = originalHTML;
                button.classList.remove('btn-success');
                button.classList.add('btn-primary');
            }, 2000);

        } catch (error) {
            button.disabled = false;
            button.innerHTML = originalHTML;
            this.showError('Failed to save changes: ' + error.message);
        }
    }

    // Selective Scan Methods
    async showSelectiveScanModal() {
        const sitemapUrl = document.getElementById('sitemapUrl').value;
        if (!sitemapUrl) {
            this.showError('Please enter a sitemap URL first');
            return;
        }

        const modal = new bootstrap.Modal(document.getElementById('selectiveScanModal'));
        modal.show();
        await this.loadSelectiveUrls(sitemapUrl);
    }

    async loadSelectiveUrls(sitemapUrl) {
        try {
            document.getElementById('selectiveUrlsList').innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="fas fa-spinner fa-spin fa-2x mb-3"></i>
                    <p>Loading sitemap URLs...</p>
                </div>
            `;

            const response = await fetch('/api/sitemap/all-urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sitemapUrl })
            });

            if (response.ok) {
                const data = await response.json();
                this.selectiveUrls = data.urls;
                this.filteredSelectiveUrls = [...this.selectiveUrls];

                document.getElementById('selectiveScanStats').textContent =
                    `Total: ${data.total} | Scanned: ${data.scanned} | Unscanned: ${data.unscanned}`;

                this.renderSelectiveUrlsList();
            } else {
                throw new Error('Failed to load sitemap URLs');
            }
        } catch (error) {
            document.getElementById('selectiveUrlsList').innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle"></i>
                    Error loading URLs: ${error.message}
                </div>
            `;
        }
    }

    renderSelectiveUrlsList() {
        const container = document.getElementById('selectiveUrlsList');

        if (this.filteredSelectiveUrls.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="fas fa-search fa-2x mb-3"></i>
                    <p>No URLs match the current filter</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.filteredSelectiveUrls.map(urlData => {
            const isSelected = this.selectedSelectiveUrls.has(urlData.url);
            const statusBadge = urlData.isScanned ?
                `<span class="badge bg-${urlData.seoStatus || 'secondary'}">${urlData.seoStatus || 'Scanned'}</span>` :
                `<span class="badge bg-warning">Unscanned</span>`;

            return `
                <div class="form-check d-flex align-items-center mb-2 p-2" style="border: 1px solid var(--border-color); border-radius: 5px;">
                    <input class="form-check-input me-2" type="checkbox" value="${urlData.url}"
                           id="url-${btoa(urlData.url)}" ${isSelected ? 'checked' : ''}
                           onchange="app.toggleSelectiveUrl('${urlData.url}')">
                    <label class="form-check-label flex-grow-1" for="url-${btoa(urlData.url)}" style="cursor: pointer; min-width: 0;">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="text-truncate" style="max-width: 70%;" title="${urlData.url}">${urlData.url}</span>
                            ${statusBadge}
                        </div>
                    </label>
                </div>
            `;
        }).join('');
    }

    toggleSelectiveUrl(url) {
        if (this.selectedSelectiveUrls.has(url)) {
            this.selectedSelectiveUrls.delete(url);
        } else {
            this.selectedSelectiveUrls.add(url);
        }

        document.getElementById('selectiveSelectedCount').textContent = this.selectedSelectiveUrls.size;
        document.getElementById('scanSelectedBtn').disabled = this.selectedSelectiveUrls.size === 0;
    }

    selectAllUnscanned() {
        this.filteredSelectiveUrls.forEach(urlData => {
            if (!urlData.isScanned) {
                this.selectedSelectiveUrls.add(urlData.url);
            }
        });
        this.renderSelectiveUrlsList();
        document.getElementById('selectiveSelectedCount').textContent = this.selectedSelectiveUrls.size;
        document.getElementById('scanSelectedBtn').disabled = this.selectedSelectiveUrls.size === 0;
    }

    selectNoneSelective() {
        this.selectedSelectiveUrls.clear();
        this.renderSelectiveUrlsList();
        document.getElementById('selectiveSelectedCount').textContent = 0;
        document.getElementById('scanSelectedBtn').disabled = true;
    }

    filterSelectiveUrls() {
        const searchTerm = document.getElementById('selectiveSearchFilter').value.toLowerCase();
        const scanFilter = document.getElementById('selectiveScanFilter').value;

        this.filteredSelectiveUrls = this.selectiveUrls.filter(urlData => {
            const matchesSearch = !searchTerm || urlData.url.toLowerCase().includes(searchTerm);

            let matchesScanFilter = true;
            if (scanFilter === 'scanned') {
                matchesScanFilter = urlData.isScanned;
            } else if (scanFilter === 'unscanned') {
                matchesScanFilter = !urlData.isScanned;
            }

            return matchesSearch && matchesScanFilter;
        });

        this.renderSelectiveUrlsList();
    }

    async scanSelectedUrls() {
        const selectedUrls = Array.from(this.selectedSelectiveUrls);
        if (selectedUrls.length === 0) {
            this.showError('Please select URLs to scan');
            return;
        }

        const sitemapUrl = document.getElementById('sitemapUrl').value;

        // Get scan options from the main form
        const options = {
            delay: parseInt(document.getElementById('delay').value) || 1000,
            timeout: parseInt(document.getElementById('timeout').value) || 10000,
            enableMboDetection: true
        };

        try {
            document.getElementById('selectiveScanProgress').style.display = 'block';
            document.getElementById('scanSelectedBtn').disabled = true;

            const response = await fetch('/api/selective-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: selectedUrls, sitemapUrl, options })
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error);
            }

            // The socket listeners will handle the progress updates and completion
        } catch (error) {
            this.showError(error.message);
            document.getElementById('selectiveScanProgress').style.display = 'none';
            document.getElementById('scanSelectedBtn').disabled = false;
        }
    }

    updateSelectiveProgress(data) {
        const progressText = document.getElementById('selectiveProgressText');
        if (progressText) {
            progressText.textContent = data.message || 'Processing...';
        }
    }

    updateSelectiveCrawlProgress(data) {
        const progressBar = document.getElementById('selectiveProgressBar');
        const progressPercent = document.getElementById('selectiveProgressPercent');
        const progressText = document.getElementById('selectiveProgressText');

        if (progressBar && data.percentage !== undefined) {
            progressBar.style.width = `${data.percentage}%`;
        }

        if (progressPercent) {
            progressPercent.textContent = `${data.percentage}%`;
        }

        if (progressText) {
            progressText.textContent = `Scanning ${data.current} of ${data.total}: ${data.url || ''}`;
        }
    }

    handleSelectiveScanComplete(data) {
        // Hide progress
        document.getElementById('selectiveScanProgress').style.display = 'none';
        document.getElementById('scanSelectedBtn').disabled = false;

        // Clear selections
        this.selectedSelectiveUrls.clear();
        document.getElementById('selectiveSelectedCount').textContent = 0;

        // Reload the URL list to show updated scan status
        const sitemapUrl = document.getElementById('sitemapUrl').value;
        this.loadSelectiveUrls(sitemapUrl);

        // Show success message
        this.showNotification(`Successfully scanned ${data.results.scannedUrls} URLs!`, 'success');

        // Also refresh the main results if they exist
        if (this.currentResults) {
            this.loadSavedResults();
        }
    }
}

// Initialize the app
const app = new SEOCheckerV2();