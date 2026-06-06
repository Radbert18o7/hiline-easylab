const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'node_modules', 'tesseract.js-core');
const destDir = path.join(__dirname, 'public', 'ocr');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

function copyDirectory(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath);
      }
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  copyDirectory(srcDir, destDir);
  console.log('Copied tesseract.js-core to public/ocr successfully.');
} catch (e) {
  console.error('Failed to copy tesseract core files:', e);
}
