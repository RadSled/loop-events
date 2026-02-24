const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, 'public', 'bundle.js');
const indexPath = path.join(__dirname, 'public', 'index.html');

const isProduction = process.env.NODE_ENV === 'production';

let bundle = fs.readFileSync(bundlePath, 'utf8');
let index = fs.readFileSync(indexPath, 'utf8');

bundle = bundle.replace(/new Function\("return this"\)\(\)/g, '(typeof globalThis!=="undefined"?globalThis:typeof window!=="undefined"?window:this)');

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
