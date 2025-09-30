# SEO Checker V2 - Testing Guide

Server is running at: **http://localhost:3838**

## ✅ Features Ready to Test

### 1. Core V2 Features (Frontend)

#### Dark Mode
- **Toggle**: Click moon icon (top right) or press **Ctrl+D**
- **Persistent**: Refreshing page keeps your theme choice
- **Test**: Switch back and forth, check if it persists

#### Keyboard Shortcuts
- Press **?** to see all shortcuts
- **Ctrl+H**: Toggle hide done items
- **Ctrl+F**: Focus search
- **Ctrl+E**: Export JSON
- **Esc**: Close overlays

#### Hide Done Toggle
1. Run a scan (or load saved results)
2. Mark some URLs as "reviewed"
3. Check the "Hide Reviewed/Done Items" box
4. Those URLs should disappear from view

#### Filtering System
- **Search Box**: Type part of a URL
- **Status Filter**: Filter by good/warning/error
- **Review Status Filter**: Filter by new/in progress/reviewed
- All filters work together!

#### View Modes
- **All Items**: Traditional list view
- **Tree View**: Hierarchical site structure (NEW!)
- **Needs Attention**: Only problem URLs
- **In Progress**: Only URLs being worked on

### 2. Quick Wins Features

#### Duplicate Detection
1. After scanning, click **"Detect Duplicates"** button
2. See all URLs with identical meta descriptions
3. Grouped by duplicate content with count

#### Character Histogram
1. Click **"Character Histogram"** button
2. See distribution of meta description lengths
3. Visual bars showing:
   - Missing (0 chars)
   - Too short (1-50)
   - Short (51-120)
   - Optimal (121-160) ← Green!
   - Long (161-200)
   - Too long (200+)

#### Quick Copy Buttons
- Every meta description has a **copy button**
- Click to copy to clipboard
- Button changes to "Copied!" for 2 seconds

### 3. Claude AI Features (Backend Only - No UI Yet)

The AI is working on the backend! You can test via command line:

#### Test AI Connection
```bash
curl http://localhost:3838/api/ai/test
```

Should return: `{"success":true,"message":"Claude AI API connected successfully"}`

#### Generate Meta Descriptions
```bash
curl -X POST http://localhost:3838/api/ai/generate-meta \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/product","title":"Amazing Product","currentMeta":"Buy now"}'
```

Returns 5 AI-generated suggestions with:
- Different styles (benefit, action, question, feature, urgency)
- All 120-160 characters (optimal)
- Cost estimate (usually $0.003-0.005 per URL)

## 🧪 Recommended Test Flow

### Test 1: Basic Scan & Navigation
1. Open http://localhost:3838
2. Enter a sitemap URL
3. Configure settings (chunk size: 10, delay: 1000ms)
4. Click "Start Analysis"
5. Watch progress bar
6. Review results when complete

### Test 2: Tree View
1. After scan completes, click **"Tree View"** tab
2. Expand/collapse folders
3. See aggregated stats per folder (good/warning/error counts)
4. Navigate your site structure hierarchically

### Test 3: Filtering & Hiding
1. Use search box to find specific URLs
2. Try different status filters
3. Mark some URLs as "reviewed"
4. Check "Hide Done" box
5. See how view changes

### Test 4: Duplicates
1. Click **"Detect Duplicates"**
2. Review any duplicate meta descriptions
3. See which URLs share the same content
4. This is a critical SEO issue!

### Test 5: Character Distribution
1. Click **"Character Histogram"**
2. Review the length distribution
3. Identify how many need fixing
4. Optimal range is 121-160 chars (green bar)

### Test 6: Dark Mode
1. Press **Ctrl+D** (or click moon icon)
2. Enjoy the dark theme
3. Refresh page - theme persists!
4. Press **Ctrl+D** again to toggle back

### Test 7: Keyboard Shortcuts
1. Press **?** to see shortcuts overlay
2. Try **Ctrl+H** to toggle hide done
3. Try **Ctrl+F** to focus search
4. Press **Esc** to close overlay

## 🐛 Known Limitations (Frontend UI Not Built Yet)

These features work on the backend but don't have UI yet:

- ❌ No "Generate AI Suggestions" button on URLs yet
- ❌ No modal to view AI suggestions
- ❌ No bulk AI rewrite interface
- ❌ No AI cost tracker display
- ❌ No keyword extraction UI

**Coming Next**: I'll build the frontend UI for AI features so you can use them visually!

## 💡 What to Look For

### Good Signs ✅
- Dark mode works smoothly
- Filters combine correctly
- Tree view shows site structure
- Hide done actually hides items
- Copy buttons work
- Keyboard shortcuts respond
- Duplicate detection is accurate
- Histogram shows meaningful data

### Issues to Report 🐛
- Any UI glitches or layout issues
- Filters not working together
- Tree view not showing correctly
- Hide done not hiding items
- Dark mode not persisting
- Keyboard shortcuts not working
- Server errors or crashes

## 📊 Compare to V1

**What V2 Adds:**
- Tree structure navigation (V1 doesn't have this)
- Hide done toggle (V1 doesn't have this)
- Enhanced filtering (V1 has basic filters)
- Duplicate detection button (V1 doesn't have this)
- Character histogram (V1 doesn't have this)
- Dark mode (V1 doesn't have this)
- Keyboard shortcuts (V1 doesn't have this)
- AI backend ready (V1 doesn't have this)

## 🎯 Priority Tests

If you're short on time, test these first:

1. **Basic Scan** - Does it work end-to-end?
2. **Tree View** - Does the structure make sense?
3. **Hide Done** - Does it actually hide reviewed items?
4. **Dark Mode** - Does it look good and persist?
5. **Duplicate Detection** - Does it find duplicates accurately?

## 🚀 Next Steps

After you've tested, let me know:
- What works well?
- What's broken or confusing?
- What would you like me to prioritize next?

Then I'll build the AI frontend UI so you can:
- Click a button to get AI suggestions
- See 5 options in a nice modal
- Copy or replace meta descriptions
- Do bulk AI rewrites
- Track your AI costs

---

**Server running at**: http://localhost:3838
**AI Status**: Backend ready, Frontend pending
**Current Model**: Claude 3 Sonnet (claude-3-sonnet-20240229)