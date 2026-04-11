const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseKey } = require('./src/supabaseClient.js');
const supabase = createClient(supabaseUrl, supabaseKey);

supabase.from('sessions')
  .select('id, date, notes, status')
  .order('created_at', { ascending: false })
  .limit(10)
  .then(({ data }) => {
    data.forEach(s => console.log(s.date, s.status, s.notes?.slice(0, 50)));
  });
