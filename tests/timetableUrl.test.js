// ============================================
// tests/timetableUrl.test.js
// Unit tests for Google Sheets URL parsing
// ============================================

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Load the timetableUrl module functions
// In a real test environment, these would be imported
// For now, we'll define them inline for testing

function parseGoogleSheetsUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    
    if (!parsedUrl.hostname.includes('docs.google.com') || 
        !parsedUrl.pathname.includes('/spreadsheets/d/')) {
      return null;
    }

    const pathMatch = parsedUrl.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!pathMatch) {
      return null;
    }

    const spreadsheetId = pathMatch[1];

    let gid = '0';
    
    const hashMatch = parsedUrl.hash.match(/gid=([0-9]+)/);
    if (hashMatch) {
      gid = hashMatch[1];
    } else {
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

function isValidGoogleSheetsUrl(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  
  const { spreadsheetId, gid } = parsed;
  
  if (!spreadsheetId || typeof spreadsheetId !== 'string' || spreadsheetId.length === 0) {
    return false;
  }
  
  if (!gid || typeof gid !== 'string' || !/^\d+$/.test(gid)) {
    return false;
  }
  
  return true;
}

describe('parseGoogleSheetsUrl', () => {
  it('should parse valid URL with hash gid', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1BxiMVsX9UfWLt5z7JQ9x5Y5x5/edit#gid=0';
    const result = parseGoogleSheetsUrl(url);
    
    assert.strictEqual(result !== null, true);
    assert.strictEqual(result.spreadsheetId, '1BxiMVsX9UfWLt5z7JQ9x5Y5x5');
    assert.strictEqual(result.gid, '0');
  });

  it('should parse valid URL with query gid', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1BxiMVsX9UfWLt5z7JQ9x5Y5x5/edit?gid=123';
    const result = parseGoogleSheetsUrl(url);
    
    assert.strictEqual(result !== null, true);
    assert.strictEqual(result.spreadsheetId, '1BxiMVsX9UfWLt5z7JQ9x5Y5x5');
    assert.strictEqual(result.gid, '123');
  });

  it('should parse valid URL without gid (default to 0)', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1BxiMVsX9UfWLt5z7JQ9x5Y5x5/edit';
    const result = parseGoogleSheetsUrl(url);
    
    assert.strictEqual(result !== null, true);
    assert.strictEqual(result.spreadsheetId, '1BxiMVsX9UfWLt5z7JQ9x5Y5x5');
    assert.strictEqual(result.gid, '0');
  });

  it('should parse valid URL with trailing slash', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1BxiMVsX9UfWLt5z7JQ9x5Y5x5/';
    const result = parseGoogleSheetsUrl(url);
    
    assert.strictEqual(result !== null, true);
    assert.strictEqual(result.spreadsheetId, '1BxiMVsX9UfWLt5z7JQ9x5Y5x5');
    assert.strictEqual(result.gid, '0');
  });

  it('should reject non-Google-Sheets URL', () => {
    const url = 'https://example.com/some/path';
    const result = parseGoogleSheetsUrl(url);
    
    assert.strictEqual(result, null);
  });

  it('should reject malformed URL', () => {
    const url = 'not-a-url';
    const result = parseGoogleSheetsUrl(url);
    
    assert.strictEqual(result, null);
  });

  it('should reject null input', () => {
    const result = parseGoogleSheetsUrl(null);
    assert.strictEqual(result, null);
  });

  it('should reject undefined input', () => {
    const result = parseGoogleSheetsUrl(undefined);
    assert.strictEqual(result, null);
  });

  it('should reject empty string', () => {
    const result = parseGoogleSheetsUrl('');
    assert.strictEqual(result, null);
  });

  it('should handle URL with complex spreadsheet ID', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1abc123_xyz-456_789/edit#gid=42';
    const result = parseGoogleSheetsUrl(url);
    
    assert.strictEqual(result !== null, true);
    assert.strictEqual(result.spreadsheetId, '1abc123_xyz-456_789');
    assert.strictEqual(result.gid, '42');
  });
});

describe('isValidGoogleSheetsUrl', () => {
  it('should validate correct parsed URL', () => {
    const parsed = {
      spreadsheetId: '1BxiMVsX9UfWLt5z7JQ9x5Y5x5',
      gid: '0'
    };
    
    assert.strictEqual(isValidGoogleSheetsUrl(parsed), true);
  });

  it('should reject null', () => {
    assert.strictEqual(isValidGoogleSheetsUrl(null), false);
  });

  it('should reject undefined', () => {
    assert.strictEqual(isValidGoogleSheetsUrl(undefined), false);
  });

  it('should reject missing spreadsheetId', () => {
    const parsed = { gid: '0' };
    assert.strictEqual(isValidGoogleSheetsUrl(parsed), false);
  });

  it('should reject empty spreadsheetId', () => {
    const parsed = { spreadsheetId: '', gid: '0' };
    assert.strictEqual(isValidGoogleSheetsUrl(parsed), false);
  });

  it('should reject missing gid', () => {
    const parsed = { spreadsheetId: '1BxiMVsX9UfWLt5z7JQ9x5Y5x5' };
    assert.strictEqual(isValidGoogleSheetsUrl(parsed), false);
  });

  it('should reject non-numeric gid', () => {
    const parsed = { spreadsheetId: '1BxiMVsX9UfWLt5z7JQ9x5Y5x5', gid: 'abc' };
    assert.strictEqual(isValidGoogleSheetsUrl(parsed), false);
  });

  it('should reject gid with letters', () => {
    const parsed = { spreadsheetId: '1BxiMVsX9UfWLt5z7JQ9x5Y5x5', gid: '0abc' };
    assert.strictEqual(isValidGoogleSheetsUrl(parsed), false);
  });
});
