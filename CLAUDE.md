# SEO Checker V2 - Development Notes

## Current State (2025-09-30)

### What's Working
- ✅ Full sitemap scanning with Puppeteer for JavaScript-rendered content
- ✅ Meta title and description extraction
- ✅ Character count validation (120-160 chars optimal)
- ✅ Issue detection (missing/short/long meta descriptions, missing titles)
- ✅ Change detection between scans
- ✅ Review status workflow (new → in_progress → done)
- ✅ Tree view for hierarchical URL organization
- ✅ Filter system (status, review status, search, hide done)
- ✅ Claude AI integration for meta description suggestions
- ✅ Bulk AI operations
- ✅ Modal popup system for detailed page editing
- ✅ SEO suggestions based on page analysis
- ✅ JSON/CSV export functionality
- ✅ Dark mode theme
- ✅ Change history tracking with timestamped versions

### MBO Integration (ePages Merchant Back Office)
- ✅ Manual MBO token entry with localStorage persistence
- ✅ Object ID extraction from `window.epConfig.objectId` during scans
- ✅ Client-side MBO URL generation: `{baseUrl}/epages/{shopId}.admin/sec{token}/?ObjectID={objectId}`
- ✅ "Edit in MBO" buttons (red #d41118) on all pages with object IDs
- ✅ Token management (set, clear, persist across refreshes)
- ⚠️ Auto-detection not working (Puppeteer session isolation prevents access to existing Chrome tabs)

### Recent UI/UX Improvements
- ✅ Simplified URL cards (title, URL, meta preview, badges only)
- ✅ Clickable cards that open detailed modal popups
- ✅ Modal with two-column layout:
  - Left: Editable title/description, issues list
  - Right: Quick actions, review status, SEO suggestions, page stats
- ✅ Rescan functionality within modal
- ✅ Long text wrapping in cards (no overflow)
- ✅ Modal without backdrop (no grey screen blocking main UI)
- ✅ Change history modal with proper z-index layering

### Known Issues
1. **Modal Interaction After Rescan** (Current Issue)
   - When rescanning from modal, scrolling becomes disabled on main UI after closing modal
   - Cause: Bootstrap modal state not properly cleaned up when using `backdrop: false`
   - Workaround implemented: Body scroll restoration on modal close event
   - Status: Requires hard refresh to test (browser caching issue)

2. **Browser Caching**
   - JavaScript changes require hard refresh (Cmd+Shift+R / Ctrl+F5)
   - New `updateModalContent()` method added but may not load without cache clear

## Current Architecture

### Frontend (public/app.js)
- ES6 class-based architecture (`SEOCheckerV2`)
- Socket.io for real-time scan progress
- Bootstrap 5 for UI components
- Modal system with dynamic content generation
- LocalStorage for MBO token persistence

### Backend (server.js)
- Express.js server
- Socket.io for WebSocket communication
- Endpoints:
  - `POST /api/scan` - Full sitemap scan
  - `POST /api/rescan-url` - Single URL rescan
  - `POST /api/ai-suggest` - Claude AI suggestions
  - `GET /api/scan-results` - Load saved results
  - `GET /api/change-history/:url` - View change history

### Web Crawler (src/webCrawler.js)
- Puppeteer-based for JavaScript rendering
- Object ID extraction from `window.epConfig.objectId`
- Configurable delay between requests
- Chrome/Chromium auto-detection

### Data Storage
- JSON files in `./data/` directory
- Format: `{sitemap-domain}-{timestamp}.json`
- Change history stored separately per URL

## Where We're Heading

### Immediate Next Steps
1. **Fix Modal/Scroll Issue**
   - Test `updateModalContent()` method with hard refresh
   - Ensure body scrolling fully restores after modal interactions
   - Consider alternative to Bootstrap modals if issues persist

2. **Modal Polish**
   - Add loading state indicators during rescan
   - Better visual feedback for save operations
   - Keyboard shortcuts (ESC to close, etc.)

3. **Testing & Validation**
   - Test full workflow: scan → modal edit → rescan → save → close
   - Verify MBO URLs work correctly with real ePages store
   - Test with various meta description lengths

### Future Enhancements
1. **Save Functionality**
   - Implement "Save Changes" button in modal
   - Option to push changes to ePages API (if available)
   - Local draft storage before committing

2. **Advanced Features**
   - Bulk edit multiple URLs
   - Custom rules/templates for meta descriptions
   - Scheduled scans
   - Email notifications for changes
   - SEO scoring system

3. **Performance**
   - Optimize Puppeteer usage (reuse browser instance)
   - Implement scan queue for large sitemaps
   - Progressive loading for tree view

4. **Integration**
   - Direct ePages API integration (if available)
   - WordPress plugin version
   - Chrome extension for quick checks

## Technical Debt
- Multiple background server processes running (need to clean up)
- No error boundary for React-style error handling
- No unit tests yet
- Hard-coded shop ID (`yxve46fvrnud`) should be configurable
- No rate limiting on AI API calls

## Configuration Files
- `ecosystem.config.v2.js` - PM2 configuration for production
- `package.json` - Dependencies and scripts
- `.env` - Environment variables (Claude API key)

## Key Dependencies
- express: Web server
- socket.io: Real-time communication
- puppeteer-core: Web scraping
- cheerio: HTML parsing
- axios: HTTP requests
- @anthropic-ai/sdk: Claude AI integration
- bootstrap: UI framework

## Development Commands
```bash
npm start          # Start server (port 3838)
npm run dev        # Development mode with nodemon
pm2 start ecosystem.config.v2.js  # Production with PM2
```

## Browser Cache Management
When making JS/CSS changes, users must hard refresh:
- Mac: Cmd+Shift+R
- Windows: Ctrl+F5 or Ctrl+Shift+R
- Safari: Cmd+Option+R

## Notes for Next Session
- User noticed scrolling disabled after modal operations
- `updateModalContent()` method added but not yet tested (cache issue)
- All code changes committed but not pushed to GitHub yet
- Consider adding cache-busting query params to JS/CSS includes