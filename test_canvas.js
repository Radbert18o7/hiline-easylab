const fs = require('fs');
const { Canvas } = require('@napi-rs/canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function test() {
  console.log("Loading pdfjs...");
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(fs.readFileSync('C:\\Users\\raulj\\hiline easy lab\\hiline-easy-lab\\test\\data\\05-versions-space.pdf')) // if exists, else just test module
  }).promise;
  console.log("PDF loaded!", doc.numPages);
}

try {
  test();
} catch (err) {
  console.log(err);
}
