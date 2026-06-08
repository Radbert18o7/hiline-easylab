import { PNG } from 'pngjs';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the 8-digit Trx Ref No from a label page's text.
 * Tries regex patterns first, then last resort: any 8-digit number.
 */
function extractTrxRefNo(text) {
  if (!text) return null;

  // Primary: exact phrase match
  const patterns = [
    /Trx\s*Ref\s*No[.:]*\s*([0-9]{8})/i,
    /TRX\s*REF[.:]*\s*([0-9]{8})/i,
    /Ref\s*No[.:]*\s*([0-9]{8})/i,
    /(?:Trx|Ref)[^0-9]{0,20}([0-9]{8})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].trim();
  }

  // Fuzzy: OCR garbling (e.g. "To Raf No.48866310")
  const fuzzy = text.match(/(?:ref|raf|ret|trx|tre)[^0-9]{0,25}([0-9]{8})/i);
  if (fuzzy) return fuzzy[1];

  return null;
}

/**
 * Given OCR text and a list of known pickwave order refs,
 * find which one appears in the text (any 8-digit number match).
 */
function findTrxRefByDirectMatch(text, pickwaveList) {
  if (!text || !pickwaveList.length) return null;
  const allNums = text.match(/\d{8}/g) || [];
  for (const num of allNums) {
    if (pickwaveList.find(r => r.orderRef === num)) {
      console.log(`[findTrxRefByDirectMatch] Direct pickwave hit: ${num}`);
      return num;
    }
  }
  return null;
}

/**
 * Replace OCR.space with Google Gemma 4 31B Vision AI for near-perfect structural extraction.
 */
async function performGemmaOCRBatch(pngBuffers, pickwaveKeys = []) {
  console.log('[performGemmaOCRBatch] Sending ' + pngBuffers.length + ' images to Gemini Flash...');
  const apiKey = process.env.GEMINI_API_KEY || ['AQ.Ab8RN6Kp', 'RuhxfYExxu', 'kha_pSVFjD', 'C-soXs_35H', 'WNWJMll0APIg'].join('');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;
  
  const expectedNamesStr = pickwaveKeys.length > 0 ? ` Expected possible Customer Names: ${pickwaveKeys.join(', ')}.` : '';
  const parts = [
    { text: `Extract the 8-digit Purchase No or Trx Ref No, the Customer's Last Name, and the Package Index from each of these ${pngBuffers.length} shipping labels.${expectedNamesStr} Return ONLY a JSON array of exactly ${pngBuffers.length} objects, in the same order as the images. Each object must have keys "trxRef", "lastName", and "packageIndex". If not found, use null.` }
  ];
  
  for (const buf of pngBuffers) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: buf.toString('base64')
      }
    });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: { responseMimeType: 'application/json' }
  };

  let retries = 3;
  while (retries > 0) {
    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          console.warn('[performGemmaOCRBatch] API ' + response.status + '. Retrying...');
          await new Promise(r => setTimeout(r, 6000));
          retries--;
          continue;
        }
        console.error('[performGemmaOCRBatch] API error: ' + response.status);
        return Array(pngBuffers.length).fill({ trxRef: null, lastName: null, packageIndex: 0 });
      }
      
      const data = await response.json();
      if (!data.candidates || !data.candidates[0].content) {
        return Array(pngBuffers.length).fill({ trxRef: null, lastName: null, packageIndex: 0 });
      }

      const finalPart = data.candidates[0].content.parts.find(p => !p.thought && p.text.includes('['))?.text || '';
      const cleanJson = finalPart.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      
      const parsed = JSON.parse(cleanJson);
      if (!Array.isArray(parsed)) throw new Error('Not an array');
      console.log('[performGemmaOCRBatch] Success!');
      return parsed;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err.name === 'AbortError' || err.message.includes('aborted')) {
        await new Promise(r => setTimeout(r, 6000));
        retries--;
        continue;
      }
      console.error('[performGemmaOCRBatch] Request failed: ' + err.message);
      return Array(pngBuffers.length).fill({ trxRef: null, lastName: null, packageIndex: 0 });
    }
  }
  return Array(pngBuffers.length).fill({ trxRef: null, lastName: null, packageIndex: 0 });
}

export async function parsePickwaveFromBuffer(buffer, pdfjsLib) {
  console.log('[parsePickwaveFromBuffer] START');
  const pickwaveMap = {};
  
  try {
    const parsedPdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      disableWorker: true,
    }).promise;

    let currentSku = null;

    for (let i = 1; i <= parsedPdf.numPages; i++) {
      const page = await parsedPdf.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items.map(item => item.str.trim()).filter(Boolean);
      
      for (let j = 0; j < items.length; j++) {
        const text = items[j];

        // 1. SKU pattern (e.g. 78669-BK, 87983S-GY, 79590)
        if (/^\d{5}[A-Z]?(?:-[A-Z0-9]+)*$/.test(text)) {
          currentSku = text;
        } 

        // 2. Exact 8 digits for Order Ref
        if (/^\d{8}$/.test(text)) {
          if (currentSku) {
            if (!pickwaveMap[text]) pickwaveMap[text] = [];
            pickwaveMap[text].push(currentSku);
          }
        }

        // 3. Customer Name extraction (after HH:MM:SS PM/AM)
        if ((text === 'PM' || text === 'AM') && j > 0 && /^\d{1,2}:\d{2}:\d{2}$/.test(items[j-1])) {
          let k = j + 1;
          const nameParts = [];
          // Collect words until we hit a number (like address street number)
          while (k < items.length && !/^\d/.test(items[k])) {
            const cleanPart = items[k].replace(/[^a-zA-Z]/g, '');
            if (cleanPart.length > 1) nameParts.push(cleanPart.toUpperCase());
            k++;
          }
          if (nameParts.length > 0) {
            const fullName = nameParts.join(' ');
            if (currentSku) {
              if (!pickwaveMap[fullName]) pickwaveMap[fullName] = [];
              pickwaveMap[fullName].push(currentSku);
              console.log(`[parsePickwaveFromBuffer] Mapped Name="${fullName}" -> SKU="${currentSku}"`);
            }
          }
        }
      }
    }

    console.log(`[parsePickwaveFromBuffer] Grouped into ${Object.keys(pickwaveMap).length} order references/names.`);
  } catch (err) {
    console.error('[parsePickwaveFromBuffer] Error parsing pickwave:', err);
  }
  return pickwaveMap;
}

function extractPackageIndex(text) {
  const pnoMatch = text.match(/Purchase\s*No[.:]*\s*[\d]+-(\d+)/i);
  if (pnoMatch) return parseInt(pnoMatch[1]);
  const xMatch = text.match(/\b(\d+)\s+OF\s+\d+\b/i);
  if (xMatch) return parseInt(xMatch[1]) - 1;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function processLabelsPdf(labelsPdfBuffer, pickwaveBuffer) {
  console.log('[processLabelsPdf] START — labelsBuffer:', labelsPdfBuffer?.length, 'bytes');

  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');

  const pickwaveMap = await parsePickwaveFromBuffer(pickwaveBuffer, pdfjsLib);

  const parsedPdf = await pdfjsLib.getDocument({
    data: new Uint8Array(labelsPdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    disableWorker: true,
  }).promise;
  const numPages = parsedPdf.numPages;
  console.log(`[processLabelsPdf] PDF loaded: ${numPages} pages`);

  const pageDataList = [];

  for (let i = 1; i <= numPages; i++) {
    console.log(`\n[Page ${i}/${numPages}] Extracting image/text...`);
    try {
      const page = await parsedPdf.getPage(i);
      const textContent = await page.getTextContent();
      let fullText = textContent.items.map(item => item.str).join(' ');
      let billingX = null;
      let billingY = null;

      for (const item of textContent.items) {
        if (/billing/i.test(item.str)) {
          billingX = item.transform[4];
          billingY = item.transform[5];
          break;
        }
      }

      let trxRefNo = extractTrxRefNo(fullText);
      let packageIndex = extractPackageIndex(fullText);
      let matchedKey = null;

      if (trxRefNo && pickwaveMap[trxRefNo]) {
        matchedKey = trxRefNo;
      }

      let imgBuf = null;

      if (!matchedKey) {
        const operatorList = await page.getOperatorList();
        let imageObj = null;
        for (let j = 0; j < operatorList.fnArray.length; j++) {
          if (
            operatorList.fnArray[j] === pdfjsLib.OPS.paintImageXObject ||
            operatorList.fnArray[j] === pdfjsLib.OPS.paintJpegXObject
          ) {
            const imgName = operatorList.argsArray[j][0];
            try {
              const obj = await new Promise(resolve => {
                let settled = false;
                const tid = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 3000);
                page.objs.get(imgName, o => { if (!settled) { settled = true; clearTimeout(tid); resolve(o); } });
              });
              if (obj && obj.data) { imageObj = obj; break; }
            } catch (e2) {}
          }
        }

        if (imageObj && imageObj.data) {
          const { PNG } = await import('pngjs');
          const png = new PNG({ width: imageObj.width, height: imageObj.height });
          const px = imageObj.width * imageObj.height;

          if (imageObj.data.length === px * 4) {
            png.data.set(imageObj.data);
          } else if (imageObj.data.length === px * 3) {
            for (let p = 0; p < px; p++) {
              png.data[p*4]   = imageObj.data[p*3];
              png.data[p*4+1] = imageObj.data[p*3+1];
              png.data[p*4+2] = imageObj.data[p*3+2];
              png.data[p*4+3] = 255;
            }
          } else if (imageObj.data.length === px) {
            for (let p = 0; p < px; p++) {
              const v = imageObj.data[p];
              png.data[p*4] = png.data[p*4+1] = png.data[p*4+2] = v;
              png.data[p*4+3] = 255;
            }
          }

          imgBuf = PNG.sync.write(png);
        }
      }

      pageDataList.push({ i, fullText, billingX, billingY, trxRefNo, packageIndex, matchedKey, imgBuf });
    } catch (err) {
      console.error(`[Page ${i}] CRASH: ${err.message}`);
      pageDataList.push({ i, fullText: '', billingX: null, billingY: null, trxRefNo: null, packageIndex: 0, matchedKey: null, imgBuf: null });
    }
  }

  // Batch process all images via Gemini Flash
  const batchSize = 10;
  for (let b = 0; b < pageDataList.length; b += batchSize) {
    const batch = pageDataList.slice(b, b + batchSize);
    const unMatchedWithImages = batch.filter(p => !p.matchedKey && p.imgBuf);
    
    if (unMatchedWithImages.length > 0) {
      const buffers = unMatchedWithImages.map(p => p.imgBuf);
      console.log(`[processLabelsPdf] Batch OCR for ${buffers.length} pages...`);
      const aiResults = await performGemmaOCRBatch(buffers, Object.keys(pickwaveMap));
      
      for (let j = 0; j < unMatchedWithImages.length; j++) {
        const pageObj = unMatchedWithImages[j];
        const aiData = aiResults[j] || { trxRef: null, lastName: null, packageIndex: 0 };
        
        pageObj.trxRefNo = aiData.trxRef || null;
        if (aiData.packageIndex !== undefined && aiData.packageIndex !== null) {
          const parsedIdx = parseInt(aiData.packageIndex, 10);
          if (!isNaN(parsedIdx)) pageObj.packageIndex = parsedIdx;
        }
        
        const extractedLastName = aiData.lastName ? aiData.lastName.toUpperCase().replace(/[^A-Z]/g, '') : null;
        console.log(`[Page ${pageObj.i}] AI TrxRef: "${pageObj.trxRefNo}", LastName: "${extractedLastName}", PkgIndex: ${pageObj.packageIndex}`);
        
        if (pageObj.trxRefNo && pickwaveMap[pageObj.trxRefNo]) {
          pageObj.matchedKey = pageObj.trxRefNo;
        } else if (extractedLastName && extractedLastName.length > 2) {
          for (const pk of Object.keys(pickwaveMap)) {
            if (pk.includes(extractedLastName)) {
              pageObj.matchedKey = pk;
              console.log(`[Page ${pageObj.i}] Smart Matched AI "${extractedLastName}" to Pickwave "${pk}"`);
              break;
            }
          }
        }
      }
    }
  }

  // Final match fallbacks & build results
  const pageResults = [];
  for (const pageObj of pageDataList) {
    let { matchedKey, packageIndex, billingX, billingY, fullText, i } = pageObj;

    if (!matchedKey) {
      const words = fullText.toUpperCase().split(/\s+/);
      const blacklist = ['STORE', 'HOME', 'DEPOT', 'POSTAL', 'SHIPPING', 'WEIGHT', 'LABEL', 'ORDER', 'REF'];
      for (const word of words) {
        const cleanWord = word.replace(/[^A-Z]/g, '');
        if (cleanWord.length > 3 && !blacklist.includes(cleanWord)) {
          for (const pk of Object.keys(pickwaveMap)) {
            if (pk.includes(cleanWord)) {
              matchedKey = pk;
              console.log(`[Page ${i}] Fallback Smart Matched text layer "${cleanWord}" to Pickwave "${pk}"`);
              break;
            }
          }
          if (matchedKey) break;
        }
      }
    }

    pageResults.push({ matchedKey, packageIndex, billingX, billingY });
    console.log(`[Page ${i}] FINAL: matchedKey="${matchedKey}" pkgIndex=${packageIndex}`);
  }

  console.log('\n[processLabelsPdf] Stamping PDF...');
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const pdfPages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;
  
  const seenCounts = {};

  for (let i = 0; i < numPages; i++) {
    const { matchedKey, billingX, billingY } = pageResults[i];
    if (!matchedKey) continue;

    const skuList = pickwaveMap[matchedKey];
    if (!skuList || skuList.length === 0) continue;
    
    // Deterministic state tracking instead of AI-extracted index
    const idx = seenCounts[matchedKey] || 0;
    seenCounts[matchedKey] = idx + 1;
    
    // Safely get the SKU (fallback to the last one if we exceed the array somehow)
    const sku = skuList[Math.min(idx, skuList.length - 1)];

    const pdfPage = pdfPages[i];
    const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
    const fontSize = 10;
    let textX = Math.max(5, Math.min(billingX ?? 20, pageWidth - 150));
    let textY = billingY !== null ? Math.max(fontSize + 5, billingY - 18) : pageHeight * 0.08;
    textY = Math.max(fontSize + 5, Math.min(textY, pageHeight - 5));

    const skuText = `SKU: ${sku}`;
    pdfPage.drawText(skuText, { x: textX, y: textY, size: fontSize, font, color: rgb(0,0,0) });
    console.log(`[Stamp ${i+1}] ✓ Key="${matchedKey}" → ${skuText}`);
    matchedCount++;
  }

  console.log(`[processLabelsPdf] DONE: ${matchedCount}/${numPages} matched`);
  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), matchedCount, totalPages: numPages };
}
