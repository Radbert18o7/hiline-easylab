const fs = require('fs');
const { Canvas } = require('@napi-rs/canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function test() {
  console.log("Loading pdf...");
  // create dummy pdf buffer
  // We can just check if pdfjsLib crashes
  console.log(pdfjsLib.version);
}
test();
