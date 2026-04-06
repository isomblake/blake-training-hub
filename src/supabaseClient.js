import { createClient } from '@supabase/supabase-js'

// Replace these with your Supabase project values
// (from Supabase Dashboard → Settings → API)
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'YOUR_PROJECT_URL'
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY'

export const supabase = createClient(supabaseUrl, supabaseKey)
