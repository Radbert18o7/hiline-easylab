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

async function runOcrMyPdf(inputBuffer) {
  const tmpDir = os.tmpdir();
  
  const tempId = Date.now() + Math.floor(Math.random() * 1000);
  const inputPath = path.join(tmpDir, `labels_in_${tempId}.pdf`);
  const outputPath = path.join(tmpDir, `labels_out_${tempId}.pdf`);

  fs.writeFileSync(inputPath, inputBuffer);

  try {
    // If deployed on Vercel (Linux serverless), WSL isn't available.
    // This try block will attempt to run it, fail, and gracefully fallback to the original buffer.
    console.log('Attempting ocrmypdf...');
    await execPromise(`ocrmypdf --force-ocr "${inputPath}" "${outputPath}"`, {
      cwd: tmpDir
    });
    
    console.log('ocrmypdf finished successfully.');
    const outBuffer = fs.readFileSync(outputPath);
    return outBuffer;
  } catch (error) {
    console.error('ocrmypdf failed. Using original buffer. Error:', error.message);
    return inputBuffer; // Fallback to original buffer
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

/**
 * Main: process labels PDF using ocrmypdf via WSL for guaranteed text layer
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

  // 2. Pre-process PDF through OCRmyPDF (adds perfectly aligned text layers to image-only PDFs)
  console.log('Sending PDF to ocrmypdf for text layer generation...');
  const ocrPdfBuffer = await runOcrMyPdf(labelsPdfBuffer);

  // 3. Load the OCR'd PDF with pdf-parse to find TrxRefNo and exact coordinates
  const pdfParse = (await import('pdf-parse')).default;
  const pageExtractionResults = [];

  function render_page(pageData) {
    return pageData.getTextContent().then(function(textContent) {
      let fullText = '';
      let billingX = null;
      let billingY = null;
      
      for (const item of textContent.items) {
        if (!item.str) continue;
        fullText += item.str + ' ';
        
        if (/billing/i.test(item.str)) {
          billingX = item.transform[4];
          billingY = item.transform[5];
        }
      }
      
      pageExtractionResults.push({
        trxRefNo: extractTrxRefNo(fullText),
        billingX,
        billingY,
        fullText
      });
      
      return fullText;
    });
  }

  await pdfParse(ocrPdfBuffer, { pagerender: render_page });
  const numPages = pageExtractionResults.length;
  
  // 4. Load the OCR'd PDF with PDF-lib for editing
  const pdfDoc = await PDFDocument.load(ocrPdfBuffer);
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
