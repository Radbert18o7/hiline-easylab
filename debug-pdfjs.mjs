import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

// Build an image-based label
const canvas = createCanvas(288, 432);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,288,432);
ctx.fillStyle = '#000'; ctx.font = '10px sans-serif';
ctx.fillText('BILLING: 3RD PARTY', 20, 320);
ctx.fillText('Trx Ref No.:48832750', 20, 335);
const pngBuf = canvas.toBuffer('image/png');

const doc = await PDFDocument.create();
const page = doc.addPage([288, 432]);
const img = await doc.embedPng(pngBuf);
page.drawImage(img, {x:0, y:0, width:288, height:432});
const labelsBuffer = Buffer.from(await doc.save());

// Now inspect what pdfjs sees
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(labelsBuffer), disableWorker: true }).promise;
const p = await pdf.getPage(1);

// Check text
const tc = await p.getTextContent();
console.log('Text items count:', tc.items.length);
console.log('Full text:', tc.items.map(i=>i.str).join(' ').substring(0, 100));

// Check operator list
const ops = await p.getOperatorList();
console.log('Total operators:', ops.fnArray.length);
const OPS = pdfjsLib.OPS;

let found = false;
for (let j = 0; j < ops.fnArray.length; j++) {
  if (ops.fnArray[j] === OPS.paintImageXObject || ops.fnArray[j] === OPS.paintJpegXObject) {
    found = true;
    const imgName = ops.argsArray[j][0];
    console.log('Found image op at j='+j+', opCode='+ops.fnArray[j]+', imgName=', imgName);
    try {
      const obj = await p.objs.get(imgName);
      if (obj) {
        console.log('imageObj: w='+obj.width+' h='+obj.height+' dataLen='+obj.data?.length+' kind='+obj.kind);
      } else {
        console.log('imageObj is null/undefined');
      }
    } catch(e) { console.log('objs.get error:', e.message, e.constructor.name); }
  }
}
if (!found) console.log('NO image operators found in the page!');

// Also check all operator types
const opSet = new Set(ops.fnArray);
console.log('Unique op codes:', [...opSet].join(','));
