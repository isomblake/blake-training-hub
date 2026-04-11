const fs = require('fs');
let c = fs.readFileSync('src/App.jsx', 'utf8');

// getRecentSessions should sort by date for history display
// but auto-detect needs created_at order to find truly latest session
// Fix: revert getRecentSessions back to date, and add a separate query for auto-detect

c = c.replace(
  `.order('created_at', { ascending: false })`,
  `.order('date', { ascending: false })`
);

// Fix auto-detect to use its own created_at sorted query
c = c.replace(
  `  // Auto-detect next routine based on last completed session
  // Filter to sessions from either meso that contain a known routine name
  useEffect(() => {
    db.getRecentSessions(20).then(sessions => {`,
  `  // Auto-detect next routine based on last completed session
  // Filter to sessions from either meso that contain a known routine name
  useEffect(() => {
    supabase.from('sessions').select('notes, status').eq('status', 'completed').order('created_at', { ascending: false }).limit(20).then(({ data: sessions }) => {`
);

fs.writeFileSync('src/App.jsx', c);

const checks = [
  ['getRecentSessions back to date', c.includes(".order('date', { ascending: false })")],
  ['auto-detect uses created_at', c.includes("order('created_at', { ascending: false }).limit(20).then(({ data: sessions })")],
];
checks.forEach(([n, p]) => console.log(p ? '✅' : '❌', n));
