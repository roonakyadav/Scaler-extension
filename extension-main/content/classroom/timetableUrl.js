// ============================================
// classroom/timetableUrl.js
// Google Sheets URL parsing and validation
// ============================================

/**
 * Parse a Google Sheets URL to extract spreadsheet ID and GID.
 * 
 * Supports URL formats:
 * - https://docs.google.com/spreadsheets/d/SHEET_ID/edit#gid=123
 * - https://docs.google.com/spreadsheets/d/SHEET_ID/edit?gid=123
 * - https://docs.google.com/spreadsheets/d/SHEET_ID/
 * 
 * @param {string} url - The Google Sheets URL
 * @returns {{spreadsheetId: string, gid: string}|null} - Parsed components or null if invalid
 */
function parseGoogleSheetsUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    
    // Must be a Google Sheets URL
    if (!parsedUrl.hostname.includes('docs.google.com') || 
        !parsedUrl.pathname.includes('/spreadsheets/d/')) {
      return null;
    }

    // Extract spreadsheet ID from path: /spreadsheets/d/SHEET_ID/...
    const pathMatch = parsedUrl.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!pathMatch) {
      return null;
    }

    const spreadsheetId = pathMatch[1];

    // Extract GID from hash fragment or query parameter
    let gid = '0'; // Default to first sheet
    
    // Try hash fragment first: #gid=123
    const hashMatch = parsedUrl.hash.match(/gid=([0-9]+)/);
    if (hashMatch) {
      gid = hashMatch[1];
    } else {
      // Try query parameter: ?gid=123
      const queryMatch = parsedUrl.searchParams.get('gid');
      if (queryMatch) {
        gid = queryMatch;
      }
    }

    return {
      spreadsheetId,
      gid
    };
  } catch (e) {
    return null;
  }
}

/**
 * Validate that a parsed Google Sheets URL is complete.
 * 
 * @param {{spreadsheetId: string, gid: string}} parsed - Parsed URL components
 * @returns {boolean} - True if valid
 */
function isValidGoogleSheetsUrl(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  
  const { spreadsheetId, gid } = parsed;
  
  // Spreadsheet ID is required and should be non-empty
  if (!spreadsheetId || typeof spreadsheetId !== 'string' || spreadsheetId.length === 0) {
    return false;
  }
  
  // GID should be a valid number string
  if (!gid || typeof gid !== 'string' || !/^\d+$/.test(gid)) {
    return false;
  }
  
  return true;
}

/**
 * Build a CSV export URL from parsed Google Sheets components.
 * 
 * @param {{spreadsheetId: string, gid: string}} parsed - Parsed URL components
 * @returns {string} - CSV export URL
 */
function buildCsvExportUrl(parsed) {
  if (!isValidGoogleSheetsUrl(parsed)) {
    throw new Error('Invalid Google Sheets URL components');
  }
  
  const { spreadsheetId, gid } = parsed;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

/**
 * Build an HTML export URL from parsed Google Sheets components.
 * 
 * @param {{spreadsheetId: string, gid: string}} parsed - Parsed URL components
 * @returns {string} - HTML export URL
 */
function buildHtmlExportUrl(parsed) {
  if (!isValidGoogleSheetsUrl(parsed)) {
    throw new Error('Invalid Google Sheets URL components');
  }
  
  const { spreadsheetId, gid } = parsed;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=html&gid=${gid}`;
}
