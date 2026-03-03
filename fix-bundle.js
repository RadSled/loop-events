const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const bundlePath = path.join(__dirname, 'public', 'index.js');
const indexPath = path.join(__dirname, 'public', 'index.html');

const isProduction = process.env.NODE_ENV === 'production';
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();

let bundle = fs.readFileSync(bundlePath, 'utf8');
let index = fs.readFileSync(indexPath, 'utf8');

bundle = bundle.replace(/new Function\("return this"\)\(\)/g, '(typeof globalThis!=="undefined"?globalThis:typeof window!=="undefined"?window:this)');

if (isProduction && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY for production build-time injection');
}

if (supabaseUrl) {
  index = index.replace(/__LE_SUPABASE_URL_VALUE__/g, supabaseUrl);
}

if (supabaseAnonKey) {
  index = index.replace(/__LE_SUPABASE_ANON_KEY_VALUE__/g, supabaseAnonKey);
}

if (isProduction) {
  bundle = bundle.replace(/"http:\/\/localhost:\d+"/g, '"https://loop-events.onrender.com"');
  index = index.replace(/"http:\/\/localhost:\d+"/g, '"https://loop-events.onrender.com"');
  console.log('Production build: replaced localhost URLs with production backend');
} else {
  console.log('Development build: localhost URLs preserved');
}

fs.writeFileSync(bundlePath, bundle);
fs.writeFileSync(indexPath, index);
console.log('Bundle cleaned');
