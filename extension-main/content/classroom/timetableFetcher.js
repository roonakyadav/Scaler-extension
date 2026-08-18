// ============================================
// classroom/timetableFetcher.js
// Source fetching abstraction for timetable data
// ============================================

/**
 * Fetch timetable source from Google Sheets.
 * Supports CSV export format.
 * 
 * @param {{spreadsheetId: string, gid: string}} source - Parsed Google Sheets URL components
 * @param {string} [format='csv'] - Export format ('csv' or 'html')
 * @returns {Promise<{type: string, content: string, url: string}>} - Fetched source data
 * @throws {Error} - If fetch fails or returns error status
 */
async function fetchTimetableSource(source, format = 'csv') {
  if (!source || !source.spreadsheetId || !source.gid) {
    throw new Error('Invalid source: missing spreadsheetId or gid');
  }

  let exportUrl;
  
  if (format === 'html') {
    exportUrl = `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/export?format=html&gid=${source.gid}`;
  } else if (format === 'csv') {
    exportUrl = `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/export?format=csv&gid=${source.gid}`;
  } else {
    throw new Error(`Unsupported format: ${format}`);
  }

  try {
    const response = await fetch(exportUrl);
    
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('Access denied: sheet may be private. Please make it publicly accessible.');
      } else if (response.status === 404) {
        throw new Error('Sheet not found: check spreadsheet ID and GID.');
      } else {
        throw new Error(`Failed to fetch timetable: HTTP ${response.status}`);
      }
    }

    const content = await response.text();
    
    if (!content || content.trim().length === 0) {
      throw new Error('Empty response from Google Sheets');
    }

    return {
      type: format,
      content,
      url: exportUrl
    };
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Network error: could not reach Google Sheets. Check your connection.');
    }
    throw error;
  }
}

/**
 * Fetch timetable via background service worker message.
 * This is a fallback for CORS issues or when background processing is needed.
 * 
 * @param {{spreadsheetId: string, gid: string}} source - Parsed Google Sheets URL components
 * @param {string} [format='csv'] - Export format
 * @returns {Promise<{type: string, content: string, url: string}>} - Fetched source data
 */
async function fetchTimetableSourceViaBackground(source, format = 'csv') {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'FETCH_TIMETABLE_SOURCE',
        source,
        format
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (!response) {
          reject(new Error('No response from background service worker'));
          return;
        }
        
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        
        resolve(response);
      }
    );
  });
}

/**
 * Try fetching with fallback to background service worker.
 * 
 * @param {{spreadsheetId: string, gid: string}} source - Parsed Google Sheets URL components
 * @param {string} [format='csv'] - Export format
 * @param {boolean} [useBackgroundFallback=true] - Whether to try background fetch on failure
 * @returns {Promise<{type: string, content: string, url: string}>} - Fetched source data
 */
async function fetchTimetableSourceWithFallback(source, format = 'csv', useBackgroundFallback = true) {
  try {
    // Try direct fetch first
    return await fetchTimetableSource(source, format);
  } catch (error) {
    if (!useBackgroundFallback) {
      throw error;
    }
    
    // Fallback to background service worker
    console.warn('[Scaler++] Direct fetch failed, trying background service worker:', error.message);
    return await fetchTimetableSourceViaBackground(source, format);
  }
}
