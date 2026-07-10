/**
 * ==========================================
 * Attendance Scanner PWA - Shared JavaScript
 * ==========================================
 * Contains: Database, Auth, Roster, Offline Detection
 */

// ==========================================
// Dexie Database Setup
// ==========================================
const db = new Dexie('AttendanceScannerDB');

// Define database schema
db.version(1).stores({
  students: 'id, name, section',  // Student roster
  outbox: '++id, studentId, officerCode, timestamp, synced'  // Attendance records
});

// ==========================================
// Configuration
// ==========================================
const CONFIG = {
  // Demo officer credentials
  officer: {
    code: 'OFFICER123',
    pin: '0000',
    name: 'John Smith',
    section: 'Section-B'
  },
  // API endpoints (for mock)
  api: {
    roster: '/api/roster',
    upload: '/api/upload-attendance'
  },
  // Demo roster for fallback
  demoRoster: [
    { id: 'STU-001', name: 'Alice Johnson', section: 'Section-A' },
    { id: 'STU-002', name: 'Bob Williams', section: 'Section-B' },
    { id: 'STU-003', name: 'Charlie Brown', section: 'Section-B' },
    { id: 'STU-004', name: 'Diana Martinez', section: 'Section-A' },
    { id: 'STU-005', name: 'Edward Lee', section: 'Section-C' },
    { id: 'STU-006', name: 'Fiona Garcia', section: 'Section-B' },
    { id: 'STU-007', name: 'George Wilson', section: 'Section-A' },
    { id: 'STU-008', name: 'Hannah Davis', section: 'Section-B' },
    { id: 'STU-009', name: 'Ian Thompson', section: 'Section-C' },
    { id: 'STU-010', name: 'Julia Anderson', section: 'Section-B' }
  ]
};

// ==========================================
// Authentication Functions
// ==========================================

/**
 * Check if user is logged in
 * @returns {boolean}
 */
function isLoggedIn() {
  return localStorage.getItem('officerLoggedIn') === 'true';
}

/**
 * Get logged in officer info
 * @returns {object|null}
 */
function getOfficerInfo() {
  const info = localStorage.getItem('officerInfo');
  return info ? JSON.parse(info) : null;
}

/**
 * Attempt officer login
 * @param {string} officerCode
 * @param {string} pin
 * @returns {boolean}
 */
function login(officerCode, pin) {
  if (officerCode === CONFIG.officer.code && pin === CONFIG.officer.pin) {
    const officerInfo = {
      code: CONFIG.officer.code,
      name: CONFIG.officer.name,
      section: CONFIG.officer.section
    };
    localStorage.setItem('officerLoggedIn', 'true');
    localStorage.setItem('officerInfo', JSON.stringify(officerInfo));
    return true;
  }
  return false;
}

/**
 * Logout officer
 */
function logout() {
  localStorage.removeItem('officerLoggedIn');
  localStorage.removeItem('officerInfo');
  window.location.href = 'index.html';
}

/**
 * Get database reference
 * @returns {Dexie}
 */
function getDb() {
  return db;
}

/**
 * Require login - redirect if not logged in
 */
function requireLogin() {
  if (!isLoggedIn()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

// ==========================================
// Roster Functions
// ==========================================

/**
 * Check if roster is cached locally
 * @returns {boolean}
 */
function isRosterCached() {
  return localStorage.getItem('rosterCached') === 'true';
}

/**
 * Fetch roster from server (mock)
 * @returns {Promise<Array>}
 */
async function fetchRosterFromServer() {
  try {
    const response = await fetch(CONFIG.api.roster);
    if (!response.ok) throw new Error('Server error');
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch roster:', error);
    throw error;
  }
}

/**
 * Save roster to local database
 * @param {Array} roster
 */
async function saveRosterToDb(roster) {
  await db.students.clear();
  await db.students.bulkPut(roster);
  localStorage.setItem('rosterCached', 'true');
}

/**
 * Normalize workbook headers so import logic can find common columns.
 * @param {string} value
 * @returns {string}
 */
function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const HEADER_ALIASES = {
  studentId: ['student id', 'studentid', 'student number', 'student no', 'studentno', 'studentnr', 'id'],
  studentName: ['student name', 'name', 'full name', 'fullname', 'student'],
  section: ['section']
};

/**
 * Normalize a student identifier for reliable lookup.
 * @param {string|number} value
 * @returns {string}
 */
function normalizeStudentId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Check whether a value looks like a student ID.
 * @param {string|number} value
 * @returns {boolean}
 */
function looksLikeStudentId(value) {
  const text = String(value || '').trim();
  return /\b\d{2,4}-\d{3,5}\b/.test(text) || /^\d{4,8}$/.test(text) || /^\d{2,4}[a-z]?\d{2,4}$/i.test(text);
}

/**
 * Check whether a value looks like a section label.
 * @param {string|number} value
 * @returns {boolean}
 */
function looksLikeSection(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^(SECTION|SEC)[-_\s]?[A-Z0-9]+$/.test(text) || /^[A-Z]{2,6}\d{1,2}[A-Z]?$/.test(text) || /^(BS|CS|IT|ENG|ART|SCI|MATH)[A-Z0-9-]+$/.test(text);
}

/**
 * Find the first non-empty value from a row based on a list of possible header aliases.
 * @param {object} row
 * @param {string[]} aliases
 * @returns {string}
 */
function findRowValue(row, aliases) {
  const normalizedRow = row || {};
  for (const alias of aliases) {
    const candidate = normalizedRow[alias];
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
      return String(candidate).trim();
    }
  }
  return '';
}

function mapRowToNormalizedObject(row) {
  const normalized = {};
  Object.keys(row || {}).forEach((key) => {
    normalized[normalizeHeader(key)] = row[key];
  });
  return normalized;
}

function hasRecognizedHeaders(row) {
  const normalized = Object.keys(row || {}).map((key) => normalizeHeader(key));
  const knownFields = ['student id', 'studentid', 'student number', 'id', 'student name', 'name', 'section', 'program'];
  return normalized.some((key) => knownFields.includes(key));
}

/**
 * Infer a section name from a student ID when the ID encodes it.
 * Examples: A-1001, B1002, SEC-A-1003, SECTIONB1004.
 * @param {string|number} studentId
 * @param {string} fallbackSection
 * @returns {string}
 */
function inferSectionFromStudentId(studentId, fallbackSection = '') {
  const normalized = String(studentId || '').trim().toUpperCase();
  if (!normalized) return fallbackSection;
  const sectionPatterns = [
    [/SECTION[-_\s]*([A-Z0-9]+)/, 'Section-$1'],
    [/SEC[-_\s]*([A-Z0-9]+)/, 'Section-$1'],
    [/^([A-Z])[-_\s]?\d+/, '$1'],
    [/^([A-Z]{1,3})\d+/, '$1'],
    [/([A-Z])\d+$/, '$1']
  ];
  for (const [pattern, template] of sectionPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const token = match[1] ? match[1].replace(/[^A-Z0-9]+/g, '') : '';
      if (!token) continue;
      if (template === 'Section-$1') return `Section-${token}`;
      return token;
    }
  }
  return fallbackSection;
}

/**
 * Convert workbook rows into student-like objects.
 * @param {object} workbook
 * @param {File} file
 * @returns {Array}
 */
function extractStudentsFromWorkbook(workbook, file) {
  const students = [];
  const fallbackSection = file.name.replace(/\.(xlsx|xls|csv)$/i, '').replace(/[_-]+/g, ' ').trim() || (workbook && workbook.SheetNames && workbook.SheetNames[0] ? workbook.SheetNames[0] : 'Imported Section');
  if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) return students;
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    let rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false }) || [];
    if (!rows.length || !hasRecognizedHeaders(rows[0])) {
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false }) || [];
      const headerRowIndex = rawRows.findIndex((row) => Array.isArray(row) && row.some((cell) => {
        const text = String(cell || '').trim().toLowerCase();
        return ['student', 'name', 'id', 'section', 'number', 'program'].some((keyword) => text.includes(keyword));
      }));
      if (headerRowIndex >= 0) {
        const headerRow = rawRows[headerRowIndex];
        const dataRows = rawRows.slice(headerRowIndex + 1);
        rows = dataRows.map((row) => {
          const record = {};
          headerRow.forEach((header, index) => {
            record[String(header || '').trim()] = row[index] || '';
          });
          return record;
        });
      }
    }
    rows.forEach((row, index) => {
      const normalizedRow = mapRowToNormalizedObject(row);
      const rowValues = Object.values(row).filter((value) => value !== undefined && value !== null && String(value).trim() !== '').map((value) => String(value).trim());
      const idValue = findRowValue(normalizedRow, HEADER_ALIASES.studentId) || rowValues.find(looksLikeStudentId) || '';
      const nameValue = findRowValue(normalizedRow, HEADER_ALIASES.studentName) || rowValues.find((value) => !looksLikeStudentId(value) && !looksLikeSection(value) && value.length > 2) || '';
      const sectionValue = findRowValue(normalizedRow, HEADER_ALIASES.section) || '';
      const inferredSection = inferSectionFromStudentId(idValue, '');
      if (!nameValue && !idValue) return;
      students.push({
        id: String(idValue || `${fallbackSection}-${index + 1}`).trim(),
        name: String(nameValue || 'Unnamed Student').trim(),
        section: String(sectionValue || inferredSection).trim()
      });
    });
  });
  return students;
}

/**
 * Read a file as ArrayBuffer with a FileReader fallback for broader browser support.
 * @param {File} file
 * @returns {Promise<ArrayBuffer|Uint8Array|string>}
 */
async function readFileContents(file) {
  if (file.arrayBuffer) return await file.arrayBuffer();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse a CSV file into an array of objects using the first row as headers.
 * @param {string} text
 * @returns {Array<object>}
 */
function parseCsvText(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return rows;
  const headers = lines[0].split(',').map((header) => header.trim().replace(/^"|"$/g, ''));
  lines.slice(1).forEach((line) => {
    const values = line.split(',').map((value) => value.trim().replace(/^"|"$/g, ''));
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });
    rows.push(record);
  });
  return rows;
}

/**
 * Import one or more Excel files as roster data.
 * Each file is treated as one section and the file name becomes the section name.
 * @param {FileList|Array} files
 * @returns {Promise<object>}
 */
async function importRosterFromFiles(files) {
  const selectedFiles = Array.from(files || []);
  if (selectedFiles.length === 0) throw new Error('Select at least one Excel file to import.');
  const importedStudents = [];
  const seenIds = new Set();
  for (const file of selectedFiles) {
    if (!file || !file.name) continue;
    const fileName = file.name.toLowerCase();
    let studentsFromFile = [];
    if (fileName.endsWith('.csv')) {
      const text = await file.text();
      const rows = parseCsvText(text);
      studentsFromFile = rows.map((row, index) => ({
        id: row['Student ID'] || row['student id'] || row.id || '',
        name: row['Student Name'] || row['student name'] || row.name || '',
        section: row['Section'] || row.section || row.class || ''
      })).filter((student) => student.id || student.name);
    } else {
      if (typeof XLSX === 'undefined') throw new Error('Excel support is not available in this browser.');
      const fileContents = await readFileContents(file);
      const workbook = XLSX.read(fileContents, { type: 'array' });
      studentsFromFile = extractStudentsFromWorkbook(workbook, file);
    }
    if (!studentsFromFile.length) throw new Error(`No student rows were found in ${file.name}.`);
    studentsFromFile.forEach((student, index) => {
      let studentId = String(student.id || '').trim();
      if (!studentId) studentId = `${student.section || 'Imported'}-${index + 1}`;
      if (seenIds.has(studentId)) studentId = `${studentId}-${index + 1}`;
      seenIds.add(studentId);
      importedStudents.push({
        id: studentId,
        name: String(student.name || 'Unnamed Student').trim(),
        section: String(student.section || 'Imported Section').trim()
      });
    });
  }
  if (!importedStudents.length) throw new Error('No students were imported.');
  await saveRosterToDb(importedStudents);
  return { count: importedStudents.length, files: selectedFiles.length };
}

/**
 * Load roster from a static Excel file located in the project root.
 * @param {string} filePath - path to the file (default: '/attendance.xlsx')
 * @returns {Promise<object>}
 */
async function importRosterFromFile(filePath = '/attendance.xlsx') {
  try {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error(`File not found (${response.status})`);
    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const fileObj = { name: filePath };
    const students = extractStudentsFromWorkbook(workbook, fileObj);
    if (!students.length) throw new Error('No student rows found');
    await saveRosterToDb(students);
    return { count: students.length, file: filePath };
  } catch (error) {
    console.error('Error loading roster from file:', error);
    throw error;
  }
}

/**
 * Setup roster - fetch from server or show error
 * @param {function} onProgress - Progress callback
 * @returns {Promise<boolean>}
 */
async function setupRoster(onProgress) {
  if (!navigator.onLine) throw new Error('No internet connection. Please reconnect and try again.');
  if (onProgress) onProgress('Connecting to server...');
  try {
    const roster = await fetchRosterFromServer();
    if (onProgress) onProgress('Saving roster...');
    await saveRosterToDb(roster);
    return true;
  } catch (error) {
    throw new Error('Server unavailable. Please try again later or use demo roster.');
  }
}

/**
 * Load demo roster for testing
 * @returns {Promise<boolean>}
 */
async function loadDemoRoster() {
  await saveRosterToDb(CONFIG.demoRoster);
  return true;
}

/**
 * Get all students from local database
 * @returns {Promise<Array>}
 */
async function getAllStudents() {
  return await db.students.toArray();
}

/**
 * Get student by ID
 * @param {string} studentId
 * @returns {Promise<object|null>}
 */
async function getStudentById(studentId) {
  const normalizedInput = String(studentId || '').trim();
  if (!normalizedInput) return null;
  const directMatch = await db.students.get(normalizedInput);
  if (directMatch) return directMatch;
  const allStudents = await db.students.toArray();
  const normalizedInputValue = normalizeStudentId(normalizedInput);
  const fallbackMatches = allStudents.filter((student) => {
    const candidateId = normalizeStudentId(student.id);
    const candidateAlt = normalizeStudentId(student.name);
    const candidateSection = normalizeStudentId(student.section);
    return candidateId === normalizedInputValue || candidateId.includes(normalizedInputValue) || normalizedInputValue.includes(candidateId) || candidateAlt.includes(normalizedInputValue) || candidateSection.includes(normalizedInputValue);
  });
  if (fallbackMatches.length > 0) return fallbackMatches[0];
  return null;
}

/**
 * Return all cached students for debugging.
 * @returns {Promise<Array>}
 */
async function debugGetAllStudents() {
  return await db.students.toArray();
}

/**
 * Add a new student to the roster (local database)
 * @param {string} id - student ID
 * @param {string} name - full name
 * @param {string} section - section
 * @returns {Promise<void>}
 */
async function addStudent(id, name, section) {
  const student = { id, name, section };
  const existing = await db.students.get(id);
  if (existing) throw new Error('Student ID already exists');
  await db.students.add(student);
  localStorage.setItem('rosterCached', 'true');
}

// ==========================================
// Attendance Functions
// ==========================================

/**
 * Record attendance for a student
 * @param {string} studentId
 * @param {string} officerCode
 * @returns {Promise<object}
 */
async function recordAttendance(studentId, officerCode) {
  const timestamp = new Date().toISOString();
  const student = await getStudentById(studentId);
  const record = {
    studentId,
    studentName: student ? student.name : '',
    studentSection: student ? student.section : '',
    officerCode,
    timestamp,
    synced: false
  };
  await db.outbox.add(record);
  return { success: true, record };
}

/**
 * Get pending (unsynced) attendance records
 * SAFE VERSION: fetches all and filters in JavaScript to avoid IndexedDB key errors
 * @returns {Promise<Array>}
 */
async function getPendingRecords() {
  try {
    const all = await db.outbox.toArray();
    return all.filter(record => !record.synced);
  } catch (error) {
    console.error('Error fetching pending records:', error);
    return [];
  }
}

/**
 * Get count of pending records
 * @returns {Promise<number>}
 */
async function getPendingCount() {
  const pending = await getPendingRecords();
  return pending.length;
}

/**
 * Get all attendance records (for sync list with student names)
 * @returns {Promise<Array>}
 */
async function getPendingRecordsWithNames() {
  const records = await getPendingRecords();
  return records.map((record) => ({
    ...record,
    studentName: record.studentName || 'Unknown',
    studentSection: record.studentSection || 'Unknown'
  }));
}

/**
 * Get all attendance records, including synced and pending.
 * @returns {Promise<Array>}
 */
async function getAllAttendanceRecords() {
  return await db.outbox.toArray();
}

/**
 * Get all attendance records with student lookup metadata.
 * @returns {Promise<Array>}
 */
async function getAllAttendanceRecordsWithNames() {
  const records = await getAllAttendanceRecords();
  return records.map((record) => ({
    ...record,
    studentName: record.studentName || 'Unknown',
    studentSection: record.studentSection || 'Unknown'
  }));
}

/**
 * Sync attendance records to server
 * @returns {Promise<boolean>}
 */
async function syncAttendanceRecords() {
  if (!navigator.onLine) throw new Error('No internet connection. Please reconnect and try again.');
  const pendingRecords = await getPendingRecords();
  if (pendingRecords.length === 0) return true;
  try {
    const response = await fetch(CONFIG.api.upload, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingRecords)
    });
    if (!response.ok) throw new Error('Server error');
    for (const record of pendingRecords) {
      await db.outbox.update(record.id, { synced: true });
    }
    return true;
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
}

/**
 * Mock sync - simulates successful upload
 * Used when API is not available for demo purposes
 * @returns {Promise<boolean>}
 */
async function mockSyncAttendanceRecords() {
  const pendingRecords = await getPendingRecords();
  if (pendingRecords.length === 0) return true;
  await new Promise(resolve => setTimeout(resolve, 1000));
  for (const record of pendingRecords) {
    await db.outbox.update(record.id, { synced: true });
  }
  return true;
}

// ==========================================
// Offline Detection
// ==========================================

/**
 * Initialize online/offline event listeners
 */
function initOnlineStatusListener() {
  window.addEventListener('online', () => window.dispatchEvent(new Event('network-online')));
  window.addEventListener('offline', () => window.dispatchEvent(new Event('network-offline')));
}

// ==========================================
// Utility Functions
// ==========================================

/**
 * Format timestamp for display
 * @param {string} isoString
 * @returns {string}
 */
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Show message to user
 * @param {string} message
 * @param {string} type - info, success, error, warning
 * @param {number} duration - ms, 0 = permanent
 */
function showMessage(message, type = 'info', duration = 3000) {
  const existingMessages = document.querySelectorAll('.message');
  existingMessages.forEach(msg => msg.remove());
  const messageEl = document.createElement('div');
  messageEl.className = `message message--${type}`;
  messageEl.textContent = message;
  const container = document.querySelector('.container');
  const firstCard = container?.querySelector('.card');
  if (firstCard) container.insertBefore(messageEl, firstCard);
  else container?.prepend(messageEl);
  if (duration > 0) setTimeout(() => messageEl.remove(), duration);
}

/**
 * Clear all local data (for logout/testing)
 */
async function clearAllData() {
  await db.students.clear();
  await db.outbox.clear();
  localStorage.removeItem('rosterCached');
  localStorage.removeItem('officerLoggedIn');
  localStorage.removeItem('officerInfo');
}

// ==========================================
// Initialize
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  initOnlineStatusListener();
});

// Export for use in other files
if (typeof window !== 'undefined') {
  window.App = {
    db,
    getDb,
    config: CONFIG,
    isLoggedIn,
    getOfficerInfo,
    login,
    logout,
    requireLogin,
    isRosterCached,
    setupRoster,
    importRosterFromFiles,
    importRosterFromFile,    // <-- NEW
    loadDemoRoster,
    getAllStudents,
    debugGetAllStudents,
    getStudentById,
    addStudent,              // <-- NEW
    recordAttendance,
    getPendingRecords,
    getPendingCount,
    getPendingRecordsWithNames,
    getAllAttendanceRecords,
    getAllAttendanceRecordsWithNames,
    syncAttendanceRecords,
    mockSyncAttendanceRecords,
    formatTime,
    showMessage,
    clearAllData
  };
}
