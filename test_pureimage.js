const fs = require('fs');
const PImage = require('pureimage');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const NodeCanvasFactory = {
  create(width, height) {
    const canvas = PImage.make(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  },
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas = PImage.make(width, height);
    canvasAndContext.context = canvasAndContext.canvas.getContext('2d');
  },
  destroy(canvasAndContext) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  },
};

async function test() {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(fs.readFileSync('C:\\Users\\raulj\\hiline easy lab\\hiline-easy-lab\\public\\window.svg')), // Dummy read, just test module
  });
  try {
    await loadingTask.promise;
  } catch(e) {}
  console.log("Works");
}
test();
