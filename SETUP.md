# Blake's Training Hub — Setup Guide

## What You're Building
A personal training app at `your-name.vercel.app` that works on phone + computer.
Every set saves to a cloud database. Your data is permanent and separate from the app code.

## Time: ~20 minutes

---

## Step 1: Create a Supabase Project (5 min)

1. Go to [supabase.com](https://supabase.com) and sign up (free tier is plenty)
2. Click **New Project**
   - Name: `training-hub`
   - Database password: pick something strong, save it somewhere
   - Region: pick closest to you (US East if you're in TN)
3. Wait ~2 minutes for it to provision
4. Go to **SQL Editor** (left sidebar)
5. Click **New Query**
6. Paste the ENTIRE contents of `supabase-schema.sql` and click **Run**
7. You should see "Success. No rows returned" — that's correct

### Get Your Keys
1. Go to **Settings** → **API** (left sidebar)
2. Copy these two values (you'll need them in Step 3):
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon/public key**: `eyJhbGci...` (the long one)

---

## Step 2: Create the App Locally (5 min)

Open Terminal and run:

```bash
# Install Node.js if you don't have it
# Mac: brew install node
# Or download from https://nodejs.org

# Create the project
npx create-react-app training-hub
cd training-hub

# Install Supabase client
npm install @supabase/supabase-js

# Install Tone.js for rest timer audio
npm install tone
```

### Replace the app files:

```bash
# Delete the default src files
rm src/App.js src/App.css src/App.test.js src/logo.svg

# Copy in the training hub files:
# 1. Copy App.jsx into src/App.jsx
# 2. Copy supabaseClient.js into src/supabaseClient.js
```

### Create `src/supabaseClient.js`:

```javascript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'YOUR_PROJECT_URL'      // ← paste from Step 1
const supabaseKey = 'YOUR_ANON_KEY'         // ← paste from Step 1

export const supabase = createClient(supabaseUrl, supabaseKey)
```

### Update `src/index.js` to use .jsx:

Change the import line from:
```javascript
import App from './App';
```
to:
```javascript
import App from './App.jsx';
```

---

## Step 3: Deploy to Vercel (5 min)

1. Create a GitHub account if you don't have one: [github.com](https://github.com)
2. Install GitHub Desktop: [desktop.github.com](https://desktop.github.com)
3. In GitHub Desktop: **File → Add Local Repository** → select your `training-hub` folder
4. If it asks to create a repo, say yes. Publish to GitHub.
5. Go to [vercel.com](https://vercel.com) and sign up with GitHub
6. Click **Import Project** → select `training-hub`
7. Add Environment Variables:
   - `REACT_APP_SUPABASE_URL` = your project URL
   - `REACT_APP_SUPABASE_ANON_KEY` = your anon key
8. Click **Deploy**
9. Your app is now live at `training-hub.vercel.app`

### Add to Phone Home Screen:
1. Open the URL in Safari (iPhone) or Chrome (Android)
2. Tap Share → "Add to Home Screen"
3. It now launches like a native app

---

## Step 4: Migrate Historical Data

When you're ready to migrate your ForceUSA_Workout_History.xlsx:
1. Upload it to a Claude chat in this project
2. Tell me "migrate my workout history to Supabase"
3. I'll generate INSERT statements you can paste into Supabase SQL Editor

---

## How to Update the App

When we make changes in Claude:
```bash
# In your terminal, from the training-hub folder:
# 1. Replace src/App.jsx with the new code
# 2. Then:
git add .
git commit -m "update from Claude"
git push
# Vercel auto-deploys in ~30 seconds
# Your phone sees the new version next time you open it
```

---

## Architecture

```
Phone/Computer (Browser)
    ↓
React App (Vercel) ← we iterate on this in Claude
    ↓
Supabase (Postgres DB) ← your data lives here permanently
```

- App code changes = safe, data untouched
- Database = permanent, backed up automatically by Supabase
- Even if we rebuild the entire app, your data stays
