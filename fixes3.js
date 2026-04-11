const fs = require('fs');
let c = fs.readFileSync('src/App.jsx', 'utf8');
c = c.replace(
  `.order('date', { ascending: false })`,
  `.order('created_at', { ascending: false })`
);
fs.writeFileSync('src/App.jsx', c);
console.log(c.includes("order('created_at'") ? '✅ Sort fixed' : '❌ Not applied');
