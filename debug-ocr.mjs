import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { PNG } from 'pngjs';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Build image-based label
const canvas = createCanvas(288, 432);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,288,432);
ctx.fillStyle = '#000000';
ctx.font = 'bold 11px Arial';
ctx.fillText('UPS GROUND', 20, 30);
ctx.font = '10px Arial';
ctx.fillText('SHIP TO: Pamela Bowen', 20, 60);
ctx.fillText('12164 Sunchase Drive', 20, 75);
ctx.fillText('BILLING: 3RD PARTY', 20, 320);
ctx.fillText('Trx Ref No.:48832750', 20, 335);
ctx.fillText('Purchase No.:337359-0', 20, 350);

const pngBuf = canvas.toBuffer('image/png');
fs.writeFileSync('debug-label.png', pngBuf);
console.log('Saved debug-label.png');

const doc = await PDFDocument.create();
const page = doc.addPage([288, 432]);
const img = await doc.embedPng(pngBuf);
page.drawImage(img, {x:0, y:0, width:288, height:432});
const labelsBuffer = Buffer.from(await doc.save());

// Extract image via pdfjs
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(labelsBuffer), disableWorker: true }).promise;
const p = await pdf.getPage(1);
const ops = await p.getOperatorList();
const OPS = pdfjsLib.OPS;

let imageObj = null;
for (let j = 0; j < ops.fnArray.length; j++) {
  if (ops.fnArray[j] === OPS.paintImageXObject || ops.fnArray[j] === OPS.paintJpegXObject) {
    const imgName = ops.argsArray[j][0];
    try {
      imageObj = await p.objs.get(imgName);
      if (imageObj && imageObj.data) {
        console.log(`Got image: kind=${imageObj.kind} w=${imageObj.width} h=${imageObj.height} dataLen=${imageObj.data.length}`);
        break;
      }
    } catch(e) { console.log('get error:', e.message); }
  }
}

if (!imageObj) { console.error('No image found'); process.exit(1); }

// Convert to PNG
const { ImageKind } = pdfjsLib;
const png = new PNG({ width: imageObj.width, height: imageObj.height });
const pixelCount = imageObj.width * imageObj.height;
console.log('Expected pixelCount*3 =', pixelCount * 3, 'actual dataLen =', imageObj.data.length);
console.log('kind:', imageObj.kind, '| RGB_24BPP =', ImageKind?.RGB_24BPP);

if (imageObj.data.length === pixelCount * 3) {
  console.log('Using RGB_24BPP path (3 bytes/pixel)');
  for (let px = 0; px < pixelCount; px++) {
    png.data[px * 4]     = imageObj.data[px * 3];
    png.data[px * 4 + 1] = imageObj.data[px * 3 + 1];
    png.data[px * 4 + 2] = imageObj.data[px * 3 + 2];
    png.data[px * 4 + 3] = 255;
  }
} else if (imageObj.data.length === pixelCount * 4) {
  console.log('Using RGBA_32BPP path (4 bytes/pixel)');
  png.data.set(imageObj.data);
} else if (imageObj.data.length === pixelCount) {
  console.log('Using GRAYSCALE path (1 byte/pixel)');
  for (let px = 0; px < pixelCount; px++) {
    const v = imageObj.data[px];
    png.data[px * 4] = v; png.data[px * 4 + 1] = v;
    png.data[px * 4 + 2] = v; png.data[px * 4 + 3] = 255;
  }
} else {
  console.error('Unknown format! dataLen='+imageObj.data.length+' expected pixelCount*3='+pixelCount*3);
  process.exit(1);
}

const imageBuffer = PNG.sync.write(png);
fs.writeFileSync('debug-extracted.png', imageBuffer);
console.log('Saved debug-extracted.png');

// Run Tesseract
console.log('Running Tesseract...');
const worker = await createWorker('eng', 1, {
  logger: m => { if (m.status) process.stdout.write('.'); },
  langPath: process.cwd(),
  cachePath: os.tmpdir(),
  gzip: false,
});
console.log('');
const { data } = await worker.recognize(imageBuffer);
await worker.terminate();

console.log('OCR text:\n---\n' + data.text + '\n---');
console.log('Words found:', data.words?.length);

// Try to extract TrxRefNo
const match = data.text.match(/Trx\s*Ref\s*No[.:]*\s*([0-9]{7,9})/i);
console.log('TrxRefNo match:', match ? match[1] : 'NOT FOUND');

// Also try fallback patterns
const eights = data.text.match(/\b[0-9]{8}\b/g);
console.log('8-digit numbers found:', eights);
