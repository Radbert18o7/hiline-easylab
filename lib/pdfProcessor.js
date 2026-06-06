import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

/**
 * Extract Trx Ref No from string
 */
function extractTrxRefNo(text) {
  if (!text) return null;
  const patterns = [
    /Trx\s*Ref\s*No[.:]*\s*([0-9]{7,9})/i,
    /TRX\s*REF[.:]*\s*([0-9]{7,9})/i,
    /Ref\s*No[.:]*\s*([0-9]{7,9})/i,
    /(?:Trx|Ref)[^0-9]{0,20}([0-9]{8})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].trim();
  }
  
  // Ultimate Fallback: If "Purchase No" exists, the 8-digit number near it is the Trx Ref No
  if (/Purchase\s*No/i.test(text)) {
    const eights = text.match(/\b[0-9]{8}\b/g);
    if (eights && eights.length > 0) return eights[eights.length - 1];
  }
  return null;
}

export function parsePickwaveRecords(fullText) {
  const records = [];
  if (!fullText) return records;

  const skuPattern = /\b(\d{4,6}(?:-[A-Z0-9]{1,3})?)\b/g;
  const skus = [];
  let m;

  while ((m = skuPattern.exec(fullText)) !== null) {
    const val = m[1];
    if (val.length >= 7 && /^\d+$/.test(val)) continue;
    if (/^(2024|2025|2026|2027|2028|2029|2030|3122)$/.test(val)) continue;
    skus.push({ sku: val, index: m.index });
  }

  // Order References are usually 8 digits, but can be 7 to 10.
  const orderRefRegex = /(?<!\d)([0-9]{7,10})(?!\d)/g;
  const orderRefs = [];
  while ((m = orderRefRegex.exec(fullText)) !== null) {
    orderRefs.push({ ref: m[1], index: m.index });
  }

  for (let i = 0; i < orderRefs.length; i++) {
    const currentRef = orderRefs[i];
    
    let trueSku = null;
    
    if (i === 0) {
      // NEW APPROACH FOR FIRST LABEL ONLY
      // This strictly extracts the SKU immediately after the Shipping Address header,
      // completely bypassing any random numbers (like 3122) in the item description.
      const firstChunk = fullText.substring(0, currentRef.index);
      const headerMatch = firstChunk.match(/Shipping\s+Address\s+(\S+)/i);
      if (headerMatch) {
         trueSku = headerMatch[1];
      } else {
         const skuFallback = firstChunk.match(/\b(\d{4,6}(?:-[A-Z0-9]{1,3})?)\b/);
         if (skuFallback) trueSku = skuFallback[1];
      }
    }
    
    // PREVIOUS APPROACH FOR THE REST OF THE LABELS (or if first label fallback)
    if (!trueSku) {
      let closestDist = Infinity;
      for (const s of skus) {
        if (s.index < currentRef.index) {
          const dist = currentRef.index - s.index;
          if (dist < closestDist && dist < 2000) {
            closestDist = dist;
            trueSku = s.sku;
          }
        }
      }
    }
    
    // OLD ADDRESS TOKENS LOGIC (Perfectly preserves what was working well)
    let nextIdx = fullText.length;
    for (const s of skus) {
      if (s.index > currentRef.index && s.index < nextIdx) {
        nextIdx = s.index;
      }
    }
    for (const r of orderRefs) {
      if (r.index > currentRef.index && r.index < nextIdx) {
        nextIdx = r.index;
      }
    }
    
    const addressBlock = fullText.substring(currentRef.index + currentRef.ref.length, nextIdx);
    const addressTokens = addressBlock.toUpperCase().match(/[A-Z0-9]{3,}/g) || [];
    
    if (trueSku) {
      records.push({
        orderRef: currentRef.ref,
        sku: trueSku,
        addressTokens
      });
    }
  }

  console.log(`Parsed ${records.length} robust Pickwave records using hybrid extraction`);
  return records;
}

const NodeCanvasFactory = {
  create(width, height) {
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  },
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  },
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  },
};

/**
 * Main: process labels PDF using Tesseract.js native OCR
 */
export async function processLabelsPdf(labelsPdfBuffer, pickwaveRecords) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  // 1. Build SKU lookup records with tough matching tokens
  let pickwaveRecordsList = [];
  if (typeof pickwaveRecords === 'string') {
    pickwaveRecordsList = parsePickwaveRecords(pickwaveRecords);
  } else if (Array.isArray(pickwaveRecords)) {
    pickwaveRecordsList = parsePickwaveRecords(pickwaveRecords.join('\n'));
  }

  // 2. Perform OCR on any image-based pages natively using Tesseract
  const { createWorker } = await import('tesseract.js');
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

  console.log('Loading PDF for OCR analysis...');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(labelsPdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    disableWorker: true,
  });
  
  const parsedPdf = await loadingTask.promise;
  const numPages = parsedPdf.numPages;
  const pageExtractionResults = [];
  
  console.log(`Initializing Tesseract worker...`);
  const worker = await createWorker('eng', 1, { 
    logger: () => {},
    cachePath: os.tmpdir(),
  });

  for (let i = 1; i <= numPages; i++) {
    const page = await parsedPdf.getPage(i);
    const textContent = await page.getTextContent();
    let fullText = textContent.items.map(item => item.str).join(' ');
    let billingX = null;
    let billingY = null;
    
    // If the PDF page has no embedded text (it's a thermal image), run Tesseract OCR
    if (fullText.trim().length < 20) {
      console.log(`Page ${i}: Image-based label detected. Rasterizing and running OCR...`);
      const viewport = page.getViewport({ scale: 2.0 }); // Scale up for better accuracy
      const canvasAndContext = NodeCanvasFactory.create(viewport.width, viewport.height);
      
      await page.render({
        canvasContext: canvasAndContext.context,
        viewport: viewport,
        canvasFactory: NodeCanvasFactory,
      }).promise;
      
      const imageBuffer = canvasAndContext.canvas.toBuffer('image/png');
      const { data } = await worker.recognize(imageBuffer);
      fullText = data.text;
      
      // Look for "BILLING" to anchor the SKU print location
      const billingWord = data.words?.find(w => w.text.toLowerCase().includes('billing'));
      if (billingWord) {
        billingX = billingWord.bbox.x0 / 2.0;
        // Convert Tesseract Y (from top) to PDF Y (from bottom)
        const scaledY = billingWord.bbox.y1 / 2.0;
        billingY = viewport.height - scaledY; 
      }
      
      NodeCanvasFactory.destroy(canvasAndContext);
    } else {
      // PDF already has a text layer, just extract coordinates natively
      for (const item of textContent.items) {
        if (/billing/i.test(item.str)) {
          billingX = item.transform[4];
          billingY = item.transform[5];
        }
      }
    }
    
    pageExtractionResults.push({
      trxRefNo: extractTrxRefNo(fullText),
      billingX,
      billingY,
      fullText
    });
  }
  
  await worker.terminate();

  // 4. Load the original PDF with PDF-lib for editing
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const pdfPages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;

  // 5. Draw the SKUs
  for (let i = 0; i < numPages; i++) {
    const pdfPage = pdfPages[i];
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
    const { trxRefNo, billingX, billingY, fullText } = pageExtractionResults[i];

    console.log(`Page ${i + 1}: TrxRef="${trxRefNo}", billingY=${billingY?.toFixed(1)}`);

    let matchedRecord = null;
    
    // A. Attempt Exact Match by TrxRefNo
    if (trxRefNo) {
      matchedRecord = pickwaveRecordsList.find(r => r.orderRef === trxRefNo);
    }
    
    // B. Tough Match (Fuzzy Fallback) via Address Tokens
    if (!matchedRecord) {
      const labelTokens = new Set((fullText || '').toUpperCase().match(/[A-Z0-9]{3,}/g) || []);
      let bestScore = 0;
      let bestRecord = null;
      
      for (const record of pickwaveRecordsList) {
        if (record.addressTokens.length === 0) continue;
        
        let matchCount = 0;
        for (const token of record.addressTokens) {
          if (labelTokens.has(token)) matchCount++;
        }
        
        const score = matchCount / record.addressTokens.length;
        if (score > bestScore) {
          bestScore = score;
          bestRecord = record;
        }
      }
      
      // If at least 25% of the Pickwave address tokens are found precisely on this label page
      if (bestScore >= 0.25) {
        const tiedRecords = pickwaveRecordsList.filter(r => {
          let mc = 0;
          for (const t of r.addressTokens) if (labelTokens.has(t)) mc++;
          return (mc / r.addressTokens.length) === bestScore;
        });
        
        if (tiedRecords.length === 1 || !trxRefNo) {
          matchedRecord = tiedRecords[0];
        } else {
          // Tie-breaker using OCR string overlap
          matchedRecord = tiedRecords.reduce((prev, curr) => {
             if (curr.orderRef.includes(trxRefNo)) return curr;
             return prev;
          });
        }
        console.log(`Page ${i + 1}: Tough Match success! Score ${(bestScore*100).toFixed(0)}% -> Mapped to OrderRef ${matchedRecord.orderRef}`);
      }
    }

    if (!matchedRecord) {
      console.warn(`Page ${i + 1}: FAILED matching. TrxRef="${trxRefNo}"`);
      continue;
    }

    const sku = matchedRecord.sku;

    const fontSize = 10;
    let textX, textY;

    if (billingY !== null) {
      textY = billingY - 18;
      textX = billingX !== null ? billingX : 20;
    } else {
      textY = pageHeight * 0.20;
      textX = 20;
    }

    textX = Math.max(5, Math.min(textX, pageWidth - 120));
    textY = Math.max(fontSize + 5, Math.min(textY, pageHeight - 5));

    const skuText = `SKU ID: "${sku}"`;
    const textWidth = font.widthOfTextAtSize(skuText, fontSize);
    
    // Draw highlight yellow background box
    pdfPage.drawRectangle({
      x: textX - 4,
      y: textY - 4,
      width: textWidth + 8,
      height: fontSize + 8,
      color: rgb(1, 0.92, 0.59),
    });

    pdfPage.drawText(skuText, {
      x: textX,
      y: textY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    console.log(`✓ Page ${i + 1}: overlaid "${skuText}"`);
    matchedCount++;
  }

  const modifiedBytes = await pdfDoc.save();
  return { buffer: Buffer.from(modifiedBytes), matchedCount, totalPages: numPages };
}
