# Classroom Feature Architecture Plan

## Overview

This document outlines the technical architecture and implementation plan for adding classroom information to Scaler++ class cards. The feature will display the classroom location (e.g., "Classroom B, 1st floor") on each class card in the Scaler dashboard by matching class cards against a timetable Google Sheet provided by the user.

---

## 1. Current Architecture

### Extension Structure

The Scaler++ extension follows a modular Chrome Extension V3 architecture:

```
extension-main/
├── manifest.json                    # Manifest V3 configuration
├── popup.html / popup.css / popup.js  # Settings UI (instant apply)
├── background/
│   ├── background.js                # Service worker entry point
│   ├── calendarSync.js              # Google Calendar sync
│   ├── companionBypass.js          # Companion mode bypass
│   ├── leetcodeLink.js              # LeetCode search proxy
│   ├── messagesProxy.js             # CORS proxy for custom messages
│   ├── summaryProxy.js              # AI summary cache + LLM proxy
│   └── videoTracker.js              # M3U8 stream capture
├── content/
│   ├── content.js                   # Entry point & message handler
│   ├── core/
│   │   ├── settings.js              # Settings management
│   │   ├── styleInjector.js         # CSS injection
│   │   └── urlObserver.js           # URL change detection
│   ├── cleaner/                     # Dashboard cleanup logic
│   ├── features/                    # Modular feature scripts
│   └── utils/
│       ├── domUtils.js              # DOM helpers
│       └── stringUtils.js           # String matching utilities
```

### Key Architectural Patterns

1. **Content Script Injection**: Two-phase injection
   - `document_start`: `themePreload.js` for early theme application
   - `document_idle`: Main feature bundle (30+ scripts)

2. **Feature Initialization**: Each feature exposes an `initFeatureName()` function called from `content.js` on page load and URL changes

3. **Settings Management**: 
   - Stored in `chrome.storage.sync` under key `cleanerSettings`
   - Instant apply via message passing (no save button)
   - Popup toggles send `toggleSetting` messages to active tab

4. **Data Fetching**: 
   - Content scripts fetch directly from Scaler APIs using browser cookies
   - Background service worker handles CORS-restricted requests via proxy modules

5. **Caching**: 
   - In-memory cache with TTL (e.g., 5-minute cache in lectureInfo.js)
   - `chrome.storage.local` for persistent caches (e.g., LeetCode links)

### Integration Points for Classroom Feature

The classroom feature should integrate at these points:

1. **New Content Script**: `content/features/classroomInfo.js`
   - Follows the pattern of `lectureInfo.js` and `instructorInfo.js`
   - Exposes `initClassroomInfo()` function
   - Registered in `content.js` initialization

2. **Popup Settings**: Add toggle in `popup.html` / `popup.js`
   - Toggle key: `classroom-info`
   - Sub-options panel for timetable URL and batch selection
   - Follows pattern of `calendar-sync` options panel

3. **Storage**: 
   - Settings in `chrome.storage.sync.cleanerSettings`
   - Timetable data cache in `chrome.storage.local`

4. **Background Service Worker**: 
   - Optional: `background/classroomSync.js` for periodic timetable refresh
   - Follows pattern of `calendarSync.js` with alarms

---

## 2. Existing Class Card Detection

### Detection Files

Three files currently detect and manipulate class cards:

1. **`lectureInfo.js`**: Adds subject and instructor tags to cards
2. **`instructorInfo.js`**: Adds instructor tags (duplicate prevention logic)
3. **`joinClassButton.js`**: Replaces "View Details" with "Join Session" for live classes

### DOM Selectors Used

**Primary Card Selector**:
```javascript
'a.me-cr-classroom-url[data-cy="classroom-link"]'
```

**Card Structure**:
```javascript
// Card container
<a.me-cr-classroom-url[data-cy="classroom-link"] href="/academy/mentee-dashboard/class/12345">
  // Card header (where tags are injected)
  <div class="mentee-card__header">
    <!-- Title, subject, instructor tags injected here -->
  </div>
  
  // Time information
  <div class="_1EQZYaGMSYVhKTiIKY-qXP">
    <div>
      <span>02:30 PM</span>
      <span class="m-l-5 m-r-5">-</span>
      <span>04:30 PM</span>
    </div>
    <span class="_3cg2nc-UIVR1CzIB7nNQ8Z">View Details</span>
  </div>
</a>
```

**Date Tab Selector**:
```javascript
'.tabs__tab--active'  // Active date tab (e.g., "23 Feb")
```

### Data Currently Extracted

**From Card DOM**:
- Class ID: Extracted from href using regex `/\/class\/(\d+)/`
- Start/End Time: Parsed from time spans (format: "02:30 PM")
- Active Date: Parsed from active tab (format: "23 Feb")

**From Scaler Events API**:
```javascript
https://www.scaler.com/academy/mentee/events/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```

**Response Structure**:
```javascript
{
  pastEvents: [...],
  futureEvents: [...]
}

// Each event contains:
{
  sbat_id: 12345,              // Class ID
  title: "Binary Search Trees", // Topic name
  instructors_name: "John Doe", // Teacher
  super_batch_name: "MERN - 2029 Grp B", // Batch/group
  date: "2024-02-23T14:30:00Z", // Start time (ISO)
  end_time: "2024-02-23T16:30:00Z", // End time (ISO)
  event_type: "lesson" | "lab" | ...
}
```

### Desktop vs Mobile Implementation

**Current State**: No explicit mobile/desktop handling in the codebase.

**Analysis**:
- The extension relies on Scaler's responsive design
- Selectors like `.mentee-card__header` and `.me-cr-classroom-url` appear to be stable across layouts
- No viewport width checks or mobile-specific selectors found
- The existing features work on both layouts without differentiation

**Implication for Classroom Feature**:
- Should work on both layouts without special handling
- If DOM differences exist, they'll need to be discovered during implementation
- Consider adding mobile-specific selectors if injection fails on mobile

### Injection Pattern

Existing features inject tags into the card header:

```javascript
const header = card.querySelector(".mentee-card__header");
const container = document.createElement("div");
container.className = "scaler-instructor-info";
container.style.display = "flex";
container.style.gap = "6px";
container.style.padding = "6px 8px 0";
header.appendChild(container);

// Tags are styled spans
const tag = document.createElement("span");
tag.className = "scaler-instructor-tag";
tag.textContent = "MERN - 2029 Grp B";
tag.style.fontSize = "11px";
tag.style.padding = "4px 6px";
tag.style.borderRadius = "6px";
tag.style.backgroundColor = "rgba(0, 115, 255, 0.08)";
container.appendChild(tag);
```

**Classroom Integration Point**: Inject classroom tag in the same container, after subject/instructor tags.

---

## 3. Timetable Data Problem

### Required Matching Fields

To match a class card to a timetable entry, we need:

**From Class Card (Available)**:
- ✅ Date: From active date tab or parsed from card
- ✅ Start Time: From card time spans (e.g., "02:30 PM")
- ✅ End Time: From card time spans (e.g., "04:30 PM")
- ✅ Subject: From `super_batch_name` in events API (e.g., "MERN - 2029 Grp B")
- ✅ Teacher: From `instructors_name` in events API (e.g., "John Doe")
- ❌ Batch/Group: Partially available in `super_batch_name` (e.g., "Grp B")
- ❌ Classroom: Not available in Scaler data

**From Timetable (Required)**:
- Date
- Start Time
- End Time
- Subject
- Teacher
- Batch/Group
- Classroom

### Matching Key

The primary matching key should be a combination of:
1. **Date + Time Window** (highest confidence)
2. **Subject + Teacher** (secondary confirmation)
3. **Batch/Group** (disambiguation for parallel classes)

### Data Normalization Challenges

**Time Formats**:
- Card: "02:30 PM" (12-hour format)
- Timetable: Could be 24-hour, Excel time format, or text
- Events API: ISO 8601 ("2024-02-23T14:30:00Z")

**Subject Names**:
- Card: "MERN - 2029 Grp B" (from `super_batch_name`)
- Timetable: Could be "MERN", "MERN Stack", "MERN 2029", etc.
- Need fuzzy matching or normalization

**Teacher Names**:
- Card: "John Doe"
- Timetable: Could be "J. Doe", "John", "Doe J.", etc.
- Need flexible matching

**Batch/Group**:
- Card: Extracted from `super_batch_name` (e.g., "Grp B")
- Timetable: Could be "Group B", "Batch B", "B", etc.
- Need normalization

### Missing Information

**Batch/Group Extraction**:
The `super_batch_name` field contains batch info but inconsistently:
- "MERN - 2029 Grp B" → Extract "Grp B"
- "CML - 2029 Grp B" → Extract "Grp B"
- "CN - 2029 Grp B" → Extract "Grp B"
- May need user to specify their batch explicitly

**Classroom Location**:
Not available anywhere in Scaler's data - this is the whole point of the feature.

---

## 4. Google Sheet Document Feasibility

### Technical Constraints

**Chrome Extension Limitations**:
1. **CORS**: Cannot directly fetch Google Sheets API from content script
2. **Authentication**: Google Sheets API requires OAuth token
3. **Permissions**: Need `https://www.googleapis.com/` host permission (already present)
4. **Public vs Private**: Public sheets can be accessed via export endpoints; private sheets require authentication

### Possible Approaches

#### A. Public Google Sheets (CSV/HTML Export)

**Feasibility**: HIGH for public sheets

**Method**:
```javascript
// Export as CSV
const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetId}`;
const response = await fetch(csvUrl);
const csvText = await response.text();
// Parse CSV...
```

**Pros**:
- No authentication required
- Simple to implement
- Works for publicly shared sheets

**Cons**:
- Only works for public sheets (anyone with link can view)
- CSV parsing needed (handle commas, quotes, line breaks)
- No structure validation
- Sheet must be published to web

**HTML Export Alternative**:
```javascript
// Export as HTML table
const htmlUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=html`;
// Parse HTML table...
```

#### B. Google Sheets API (Authenticated)

**Feasibility**: MEDIUM - requires OAuth setup

**Method**:
- Use existing OAuth2 client ID in manifest
- Add `https://www.googleapis.com/auth/spreadsheets.readonly` scope
- Fetch via background service worker (to handle CORS)
- Parse JSON response

**Pros**:
- Works for private sheets (user's own sheets)
- Structured JSON response
- Can access multiple sheets
- More reliable parsing

**Cons**:
- Requires OAuth consent flow
- Additional scope in manifest
- More complex implementation
- User must grant additional permissions

#### C. Google Docs (Document)

**Feasibility**: LOW - documents are unstructured

**Method**:
- Export as HTML or plain text
- Parse with regex/heuristics
- Highly fragile

**Cons**:
- No tabular structure guarantee
- Parsing is fragile
- Not recommended

### Recommended Approach: Start with Public CSV Export

**Rationale**:
1. **Lowest friction**: No OAuth changes needed
2. **Sufficient for MVP**: Most timetables can be shared publicly
3. **Fast to implement**: CSV parsing is straightforward
4. **Fallback path**: Can add authenticated API later if needed

**Implementation Plan**:
1. Accept Google Sheets URL from user
2. Extract sheet ID from URL
3. Fetch CSV export
4. Parse CSV into structured data
5. Cache in `chrome.storage.local`
6. Match against class cards

**URL Parsing**:
```javascript
// https://docs.google.com/spreadsheets/d/1BxiM.../edit#gid=0
const sheetId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)[1];
const gid = url.match(/gid=([0-9]+)/)?.[1] || "0";
```

**Fallback Hierarchy**:
1. **Priority 1**: Public CSV export (implement first)
2. **Priority 2**: Authenticated Google Sheets API (if CSV fails)
3. **Priority 3**: Manual configuration (if both fail)

---

## 5. Recommended Architecture

### Approach Comparison

| Approach | Pros | Cons | Complexity |
|----------|------|------|------------|
| **A. Direct Google Sheet Parsing** | No external dependencies, user controls data | Requires public sheet or OAuth, parsing fragile | Medium |
| **B. Remote Classroom Database** | Reliable, structured data | Requires backend, maintenance overhead, privacy concerns | High |
| **C. User Manual Configuration** | No parsing needed, works for any source | High user effort, error-prone, tedious | Low |
| **D. Hybrid** | Flexible, fallback options | More complex, multiple code paths | High |

### Recommendation: Hybrid Approach (A → C)

**Primary: Direct Google Sheet Parsing (Public CSV)**
- Implement first
- Covers 80% of use cases (public timetables)
- User provides URL once, extension handles rest

**Fallback: Manual Configuration**
- Implement if Google Sheet parsing proves unreliable
- User manually maps: (date, time, subject) → classroom
- Stored as JSON in extension settings
- Can be edited via popup UI

**Future: Authenticated API**
- Add if users request private sheet support
- Requires OAuth scope addition
- Can be added without breaking existing functionality

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        User Flow                            │
└─────────────────────────────────────────────────────────────┘

1. User opens Scaler++ popup
2. User enables "Classroom Info" toggle
3. User enters Google Sheets URL
4. User selects/enters their batch/group
5. Extension fetches and parses timetable
6. Extension caches timetable locally
7. User navigates to Scaler dashboard
8. Extension matches class cards to timetable
9. Classroom labels appear on cards

┌─────────────────────────────────────────────────────────────┐
│                    Component Architecture                     │
└─────────────────────────────────────────────────────────────┘

Popup (popup.html/js)
├── Toggle: classroom-info
├── Input: timetable-url
├── Input: batch-group (dropdown or text)
└── Button: "Refresh Timetable"

Content Script (content/features/classroomInfo.js)
├── initClassroomInfo()
├── fetchTimetable() → background proxy or direct fetch
├── parseTimetableCSV()
├── matchClassToTimetable()
├── injectClassroomLabel()
└── observeDashboard()

Background Service Worker (background/classroomSync.js - optional)
├── Alarm: refresh timetable every 24 hours
├── Fetch and parse timetable
├── Update cache in chrome.storage.local

Storage
├── chrome.storage.sync.cleanerSettings
│   ├── classroom-info: boolean
│   ├── timetable-url: string
│   └── batch-group: string
└── chrome.storage.local
    ├── classroom-timetable-cache: { data, timestamp }
    └── classroom-manual-overrides: { classId: classroom }
```

---

## 6. Matching Algorithm

### Matching Strategy

**Primary Match: Date + Time Window**

```javascript
function matchByDateTime(classCard, timetableRows) {
  const cardDate = parseCardDate(cardCard);
  const cardStart = parseCardTime(cardCard, 'start');
  const cardEnd = parseCardTime(cardCard, 'end');
  
  return timetableRows.filter(row => {
    const rowDate = parseRowDate(row.date);
    const rowStart = parseRowTime(row.startTime);
    const rowEnd = parseRowTime(row.endTime);
    
    // Date must match exactly
    if (!isSameDay(cardDate, rowDate)) return false;
    
    // Time windows must overlap (allow 5-minute tolerance)
    const tolerance = 5 * 60 * 1000; // 5 minutes
    const startDiff = Math.abs(cardStart - rowStart);
    const endDiff = Math.abs(cardEnd - rowEnd);
    
    return startDiff <= tolerance && endDiff <= tolerance;
  });
}
```

**Secondary Match: Subject + Teacher**

```javascript
function matchBySubjectTeacher(classCard, candidates) {
  const cardSubject = normalizeSubject(cardCard.super_batch_name);
  const cardTeacher = normalizeTeacher(cardCard.instructors_name);
  
  return candidates.find(row => {
    const rowSubject = normalizeSubject(row.subject);
    const rowTeacher = normalizeTeacher(row.teacher);
    
    const subjectMatch = isSubjectSimilar(cardSubject, rowSubject);
    const teacherMatch = isTeacherSimilar(cardTeacher, rowTeacher);
    
    // Require at least one to match, prefer both
    if (subjectMatch && teacherMatch) return { confidence: 1.0, row };
    if (subjectMatch) return { confidence: 0.8, row };
    if (teacherMatch) return { confidence: 0.6, row };
    
    return null;
  });
}
```

**Tertiary Match: Batch/Group**

```javascript
function matchByBatch(classCard, candidates, userBatch) {
  if (!userBatch) return candidates[0]; // No batch info, return first match
  
  const cardBatch = extractBatch(classCard.super_batch_name);
  const normalizedUserBatch = normalizeBatch(userBatch);
  
  return candidates.find(row => {
    const rowBatch = normalizeBatch(row.batch);
    return rowBatch === normalizedUserBatch || cardBatch === rowBatch;
  });
}
```

### Normalization Functions

**Subject Normalization**:
```javascript
function normalizeSubject(subject) {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/mern/g, 'mern') // Standardize abbreviations
    .replace(/cml/g, 'cml')
    .replace(/cn/g, 'cn');
}
```

**Teacher Normalization**:
```javascript
function normalizeTeacher(teacher) {
  return teacher
    .toLowerCase()
    .replace(/[.,]/g, '')
    .trim();
}
```

**Batch Normalization**:
```javascript
function normalizeBatch(batch) {
  return batch
    .toLowerCase()
    .replace(/group/g, 'grp')
    .replace(/batch/g, 'grp')
    .trim();
}
```

### Confidence Scoring

```javascript
function calculateMatchScore(dateTimeMatch, subjectMatch, teacherMatch, batchMatch) {
  let score = 0;
  
  // Date/time is mandatory
  if (!dateTimeMatch) return 0;
  score += 0.4; // 40% for date/time match
  
  // Subject adds confidence
  if (subjectMatch) score += 0.3;
  
  // Teacher adds confidence
  if (teacherMatch) score += 0.2;
  
  // Batch disambiguates
  if (batchMatch) score += 0.1;
  
  return score;
}
```

**Thresholds**:
- Score ≥ 0.7: High confidence, auto-match
- Score 0.4-0.7: Medium confidence, match but flag for review
- Score < 0.4: Low confidence, don't match

### Fuzzy Matching

For subject/teacher matching, use existing `stringUtils.js` helpers:

```javascript
// From stringUtils.js
const subjectSimilar = isTitleSimilar(cardSubject, rowSubject);
const teacherSimilar = isTitleSimilar(cardTeacher, rowTeacher);
```

### Edge Case Handling

**Duplicate Classes**:
- Same subject/teacher at different times
- Use batch/group to disambiguate
- If still ambiguous, show multiple options or ask user

**Missing Fields**:
- If teacher missing from timetable, match on subject + time
- If subject missing, match on teacher + time
- If both missing, match on time only (low confidence)

**Time Tolerance**:
- Allow ±5 minute tolerance for time matching
- Scaler times may not exactly match timetable times

---

## 7. Storage

### Settings Storage (chrome.storage.sync)

```javascript
// In popup.js DEFAULT_SETTINGS
const DEFAULT_SETTINGS = {
  // ... existing settings
  "classroom-info": false,
  "timetable-url": "",
  "batch-group": "",
  "timetable-refresh-interval": 24, // hours
};

// In popup.html
<label class="toggle-item highlight">
  <div class="toggle-info">
    <span class="toggle-title">🏫 Classroom Info</span>
    <span class="toggle-desc">Show classroom location on class cards</span>
  </div>
  <div class="toggle-switch">
    <input type="checkbox" id="toggle-classroom-info" />
    <span class="slider"></span>
  </div>
</label>

<div id="classroom-info-options" class="sub-options" style="display: none">
  <div class="sub-option-row">
    <span class="sub-option-label">Timetable URL:</span>
    <input type="text" id="timetable-url" class="text-input" placeholder="https://docs.google.com/spreadsheets/d/..." />
  </div>
  <div class="sub-option-row">
    <span class="sub-option-label">Batch/Group:</span>
    <input type="text" id="batch-group" class="text-input" placeholder="e.g., Grp B" />
  </div>
  <div class="sub-option-row">
    <button id="refresh-timetable-btn" class="sync-btn">Refresh Timetable</button>
    <span id="timetable-status" class="sync-status"></span>
  </div>
</div>
```

### Timetable Cache (chrome.storage.local)

```javascript
// Cache structure
{
  "classroom-timetable-cache": {
    data: [
      {
        date: "2024-02-23",
        startTime: "14:30",
        endTime: "16:30",
        subject: "MERN",
        teacher: "John Doe",
        batch: "Grp B",
        classroom: "Classroom B, 1st floor"
      },
      // ... more rows
    ],
    timestamp: 1708704000000, // Unix timestamp
    url: "https://docs.google.com/spreadsheets/d/...",
    version: 1 // For cache invalidation on format changes
  }
}
```

### Manual Overrides (chrome.storage.local)

```javascript
// For user-specified manual mappings
{
  "classroom-manual-overrides": {
    "12345": { // class ID
      classroom: "Classroom A, 2nd floor",
      manual: true
    }
  }
}
```

### Cache Invalidation

```javascript
// Check cache age (24-hour TTL)
function isCacheValid(cache) {
  if (!cache) return false;
  const age = Date.now() - cache.timestamp;
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  return age < maxAge;
}

// Force refresh on URL change
function shouldRefreshCache(newUrl, cache) {
  if (!cache) return true;
  return cache.url !== newUrl;
}
```

### Storage Access Pattern

```javascript
// In classroomInfo.js
async function getTimetableData() {
  const settings = await chrome.storage.sync.get("cleanerSettings");
  const { timetableUrl, batchGroup } = settings.cleanerSettings;
  
  if (!timetableUrl) return null;
  
  const cache = await chrome.storage.local.get("classroom-timetable-cache");
  const cached = cache["classroom-timetable-cache"];
  
  if (isCacheValid(cached) && !shouldRefreshCache(timetableUrl, cached)) {
    return cached.data;
  }
  
  // Fetch fresh data
  const freshData = await fetchAndParseTimetable(timetableUrl);
  
  await chrome.storage.local.set({
    "classroom-timetable-cache": {
      data: freshData,
      timestamp: Date.now(),
      url: timetableUrl,
      version: 1
    }
  });
  
  return freshData;
}
```

---

## 8. Desktop/Mobile Rendering

### Injection Point

**Desktop Layout**:
```javascript
// Inject into card header, after existing tags
const header = card.querySelector(".mentee-card__header");
const existingContainer = header.querySelector(".scaler-instructor-info") || 
                          header.querySelector(".scaler-lecture-instructor-info");

if (existingContainer) {
  // Append to existing container
  const classroomTag = buildClassroomTag(classroom);
  existingContainer.appendChild(classroomTag);
} else {
  // Create new container
  const container = document.createElement("div");
  container.className = "scaler-classroom-info";
  // ... styling
  header.appendChild(container);
}
```

**Mobile Layout**:
- Same injection point (Scaler uses responsive classes)
- If DOM differs, add mobile-specific selector as fallback
- Test on actual mobile viewport during implementation

### Styling

```javascript
const classroomTag = document.createElement("span");
classroomTag.className = "scaler-classroom-tag";
classroomTag.textContent = `🏫 ${classroom}`;
classroomTag.style.fontSize = "11px";
classroomTag.style.padding = "4px 6px";
classroomTag.style.borderRadius = "6px";
classroomTag.style.backgroundColor = "rgba(255, 152, 0, 0.1)"; // Orange for classroom
classroomTag.style.color = "#e65100";
classroomTag.style.letterSpacing = "0.2px";
```

### Responsive Considerations

**Potential Issues**:
1. Mobile cards may have less horizontal space
2. Tags may wrap to multiple lines
3. Card layout may be vertical instead of horizontal

**Mitigations**:
1. Use `flex-wrap: wrap` on container
2. Limit tag length (truncate if needed)
3. Test on mobile viewport (375px width)
4. Add mobile-specific CSS if needed

### Fallback for Missing Elements

```javascript
function injectClassroomLabel(card, classroom) {
  const header = card.querySelector(".mentee-card__header");
  
  if (header) {
    // Desktop/mobile standard layout
    injectInHeader(header, classroom);
  } else {
    // Fallback: try alternative selectors
    const altContainer = card.querySelector("[class*='card-header']") ||
                         card.querySelector("[class*='header']");
    if (altContainer) {
      injectInHeader(altContainer, classroom);
    } else {
      console.warn("[Scaler++] Could not find injection point for classroom label");
    }
  }
}
```

---

## 9. Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1)

**Goal**: Basic structure without Google Sheets integration

1. **Create content script skeleton**
   - `content/features/classroomInfo.js`
   - `initClassroomInfo()` function
   - Register in `content.js`
   - Add toggle in `popup.html`/`popup.js`

2. **Add settings UI**
   - Toggle in popup
   - Sub-options panel (URL input, batch input, refresh button)
   - Storage in `chrome.storage.sync`

3. **Implement card detection**
   - Reuse existing selector: `a.me-cr-classroom-url[data-cy="classroom-link"]`
   - Set up MutationObserver for dynamic cards
   - Extract date/time from cards

4. **Test infrastructure**
   - Add test file: `tests/classroomInfo.test.js`
   - Test card detection
   - Test data extraction

**Deliverable**: Extension with toggle and card detection, no classroom display yet

---

### Phase 2: Google Sheets Integration (Week 2)

**Goal**: Fetch and parse timetable from Google Sheets

1. **Implement CSV fetching**
   - Parse Google Sheets URL to extract sheet ID and GID
   - Fetch CSV export endpoint
   - Handle CORS via background service worker if needed

2. **CSV parsing**
   - Parse CSV into array of objects
   - Handle quoted fields, commas, line breaks
   - Validate required columns (date, time, subject, classroom)

3. **Caching**
   - Store in `chrome.storage.local`
   - Implement TTL (24 hours)
   - Add refresh button in popup

4. **Error handling**
   - Invalid URL
   - Private sheet (403 error)
   - Malformed CSV
   - Missing columns

**Deliverable**: Can fetch and cache timetable data

---

### Phase 3: Matching Algorithm (Week 3)

**Goal**: Match class cards to timetable entries

1. **Implement matching logic**
   - Date/time matching with tolerance
   - Subject normalization and matching
   - Teacher normalization and matching
   - Batch/group disambiguation

2. **Confidence scoring**
   - Calculate match scores
   - Apply thresholds
   - Handle low-confidence matches

3. **Testing**
   - Unit tests for matching functions
   - Test with sample timetable data
   - Test edge cases (duplicates, missing fields)

**Deliverable**: Can match class cards to timetable rows

---

### Phase 4: UI Injection (Week 4)

**Goal**: Display classroom labels on cards

1. **Implement injection**
   - Build classroom tag element
   - Inject into card header
   - Style to match existing tags

2. **Handle both layouts**
   - Test on desktop
   - Test on mobile viewport
   - Add fallback selectors if needed

3. **Observer setup**
   - MutationObserver for dynamic cards
   - Debounce to avoid excessive re-injection
   - Prevent duplicate injection

**Deliverable**: Classroom labels appear on cards

---

### Phase 5: Polish and Edge Cases (Week 5)

**Goal**: Handle real-world edge cases

1. **Manual overrides**
   - Allow user to manually specify classroom for a class
   - Store in `chrome.storage.local`
   - Override automatic matching

2. **Error states**
   - Show error message in popup if fetch fails
   - Show "Classroom not found" on card if no match
   - Graceful degradation

3. **Performance**
   - Optimize matching algorithm
   - Cache match results
   - Debounce observer callbacks

4. **Documentation**
   - Update README with classroom feature
   - Add user guide for setting up timetable
   - Document troubleshooting steps

**Deliverable**: Production-ready feature

---

### Phase 6: Optional Enhancements (Future)

1. **Authenticated Google Sheets API**
   - Add OAuth scope
   - Support private sheets
   - Fallback if CSV export fails

2. **Background refresh**
   - Add alarm for periodic refresh
   - `background/classroomSync.js`
   - Follow `calendarSync.js` pattern

3. **Batch auto-detection**
   - Parse batch from `super_batch_name`
   - Auto-suggest in popup
   - Reduce user configuration

4. **Multiple timetable support**
   - Support different timetables for different subjects
   - Allow user to specify sheet per subject

---

## 10. Risks and Edge Cases

### Technical Risks

**1. Google Sheets Access**
- **Risk**: User's sheet is private, CSV export fails
- **Mitigation**: Clear error message in popup, guide user to make sheet public or use manual config
- **Fallback**: Implement authenticated API in Phase 6

**2. CSV Parsing Fragility**
- **Risk**: Timetable format changes, parsing breaks
- **Mitigation**: Validate required columns, provide clear error messages
- **Fallback**: Allow manual configuration as backup

**3. DOM Changes**
- **Risk**: Scaler changes card structure, selectors break
- **Mitigation**: Use multiple selector fallbacks, monitor for failures
- **Fallback**: Feature gracefully degrades if injection fails

**4. CORS Issues**
- **Risk**: Cannot fetch Google Sheets from content script
- **Mitigation**: Route through background service worker
- **Fallback**: Use background proxy pattern from `leetcodeLink.js`

### Data Quality Risks

**5. Timetable Inaccuracy**
- **Risk**: Timetable is outdated or incorrect
- **Mitigation**: Show refresh timestamp, allow manual override
- **User Action**: User can refresh or manually correct

**6. Matching Ambiguity**
- **Risk**: Multiple classes match same timetable row
- **Mitigation**: Use batch/group for disambiguation, confidence scoring
- **Fallback**: Show multiple options or ask user to resolve

**7. Time Zone Issues**
- **Risk**: Timetable times in different timezone than Scaler
- **Mitigation**: Assume same timezone (both IST for Scaler), document assumption
- **Fallback**: Allow user to specify timezone offset

**8. Subject Name Variations**
- **Risk**: "MERN" vs "MERN Stack" vs "MERN 2029"
- **Mitigation**: Normalization, fuzzy matching using `stringUtils.js`
- **Fallback**: Manual override for specific classes

### User Experience Risks

**9. Configuration Complexity**
- **Risk**: Users struggle to set up timetable URL
- **Mitigation**: Clear instructions in popup, example URL, validation
- **Fallback**: Provide preset timetables if available

**10. Mobile Layout Issues**
- **Risk**: Classroom labels break mobile layout
- **Mitigation**: Test on mobile, responsive styling, fallback selectors
- **Fallback**: Hide on mobile if layout breaks

**11. Performance Impact**
- **Risk**: Matching algorithm slows down dashboard
- **Mitigation**: Cache match results, debounce observer, efficient data structures
- **Fallback**: Disable feature if performance degrades

**12. Privacy Concerns**
- **Risk**: Users concerned about sharing timetable URL
- **Mitigation**: Store locally only, don't send to external servers, document privacy
- **Fallback**: Manual configuration doesn't require URL

### Business Logic Risks

**13. Timetable Changes**
- **Risk**: Timetable updated mid-semester, extension shows old data
- **Mitigation**: 24-hour cache TTL, manual refresh button
- **User Action**: User refreshes when timetable changes

**14. Holiday/Exam Schedule**
- **Risk**: Timetable doesn't account for holidays, shows classroom for cancelled classes
- **Mitigation**: Not in scope - extension shows what's in timetable
- **User Action**: User can manually override or disable temporarily

**15. LAB Classes**
- **Risk**: LAB classes have different classroom logic
- **Mitigation**: Check `event_type` field, handle separately if needed
- **Fallback**: Show classroom from timetable regardless of event type

**16. Multiple Classrooms**
- **Risk**: Class uses multiple classrooms (e.g., lecture + lab)
- **Mitigation**: Show all classrooms separated by comma
- **Fallback**: Show first classroom, add note about multiple

**17. Different Batch Groups**
- **Risk**: User in different batch than timetable
- **Mitigation**: User specifies their batch, filter accordingly
- **Fallback**: Show all batches, let user identify theirs

**18. Users with Different Schedules**
- **Risk**: Timetable is generic, user has custom schedule
- **Mitigation**: Manual override for specific classes
- **Fallback**: User can fully disable automatic matching and use manual config

### Implementation Risks

**19. Testing Coverage**
- **Risk**: Insufficient test coverage, bugs in production
- **Mitigation**: Unit tests for matching logic, integration tests for full flow
- **Fallback**: Monitor for user reports, quick iteration

**20. Backward Compatibility**
- **Risk**: Changes break existing features
- **Mitigation**: Follow existing patterns, minimal changes to shared code
- **Fallback**: Feature toggle can be disabled if issues arise

**21. Extension Size**
- **Risk**: Feature increases extension size significantly
- **Mitigation**: Minimal dependencies, efficient code
- **Fallback**: No external libraries added

**22. Maintenance Burden**
- **Risk**: Feature requires ongoing maintenance as Scaler changes
- **Mitigation**: Robust selectors, graceful degradation, monitoring
- **Fallback**: Feature can be disabled if maintenance burden too high

---

## Conclusion

This plan provides a comprehensive architecture for adding classroom information to Scaler++ class cards. The recommended approach prioritizes:

1. **User Control**: User provides timetable URL and batch info
2. **Simplicity**: Start with public CSV export, add complexity only if needed
3. **Robustness**: Multiple fallbacks, graceful degradation, error handling
4. **Maintainability**: Follow existing patterns, modular design, comprehensive testing

The implementation is broken into 6 phases over 5 weeks, with clear deliverables and fallback options at each stage. The feature integrates seamlessly with the existing extension architecture and follows established patterns for settings, storage, and UI injection.

The hybrid approach (automatic matching with manual override) balances automation with user control, ensuring the feature works for most users while providing escape hatches for edge cases.
