// Test how page.objs.get actually works in pdfjs 3.x
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

const canvas = createCanvas(288, 432);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0,0,288,432);
ctx.fillStyle = '#000'; ctx.font = '10px sans-serif';
ctx.fillText('BILLING: 3RD PARTY', 20, 320);
ctx.fillText('Trx Ref No.:48832750', 20, 335);
const pngBuf = canvas.toBuffer('image/png');

const doc = await PDFDocument.create();
const page = doc.addPage([288, 432]);
const img = await doc.embedPng(pngBuf);
page.drawImage(img, {x:0, y:0, width:288, height:432});
const buf = Buffer.from(await doc.save());

const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), disableWorker: true }).promise;
const p = await pdf.getPage(1);
const ops = await p.getOperatorList();
const OPS = pdfjsLib.OPS;

for (let j = 0; j < ops.fnArray.length; j++) {
  if (ops.fnArray[j] === OPS.paintImageXObject || ops.fnArray[j] === OPS.paintJpegXObject) {
    const imgName = ops.argsArray[j][0];
    console.log('imgName:', imgName);
    
    // Test 1: Direct await
    try {
      const obj1 = await p.objs.get(imgName);
      console.log('await objs.get result:', obj1 ? `w=${obj1.width}` : 'NULL');
    } catch(e) { console.log('await error:', e.message); }
    
    // Test 2: Callback style
    await new Promise((resolve) => {
      p.objs.get(imgName, (obj2) => {
        console.log('callback objs.get result:', obj2 ? `w=${obj2.width} h=${obj2.height} kind=${obj2.kind} dataLen=${obj2.data?.length}` : 'NULL');
        resolve();
      });
    });
    
    break;
  }
}
