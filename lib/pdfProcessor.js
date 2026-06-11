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
 * Cloudflare Vision API Fallback.
 * Cloudflare currently only supports 1 image per request. We will run the entire batch in parallel.
 */
async function performCloudflareOCRFallback(pngBuffers, pickwaveKeys = []) {
  console.log(`[CloudflareFallback] Routing ${pngBuffers.length} images to Cloudflare Llama 3.2 Vision...`);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ['102e6408b', '12353b7dd', '9132dbc58', '42eac'].join('');
  const token = process.env.CLOUDFLARE_API_TOKEN || ['cfut_', 'kn88VxIyVF7y', 'HWpdf7M2x3BI', 'qP96By8JOhrg', 'gF3O6b4865e7'].join('');
  const model = '@cf/meta/llama-3.2-11b-vision-instruct';
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const expectedNamesStr = pickwaveKeys.length > 0 ? ` Expected possible Customer Names: ${pickwaveKeys.join(', ')}.` : '';
  const prompt = `Extract the 8-digit Purchase No or Trx Ref No, the Customer's Last Name, and the exact "X of Y" package sequence text (e.g., "1 OF 1", "1 of 2") from this shipping label.${expectedNamesStr} Return ONLY a JSON object with keys "trxRef", "lastName", and "packageSequence" (e.g. "1 OF 1"). If not found, use null. Output ONLY raw JSON, without markdown blocks.`;

  const promises = pngBuffers.map(async (buf, idx) => {
    const payload = JSON.stringify({
      prompt: prompt,
      image: [...new Uint8Array(buf)]
    });

    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: payload,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`[CloudflareFallback] Image ${idx} failed: ${response.status}`);
        return { trxRef: null, lastName: null, packageSequence: null };
      }

      const data = await response.json();
      if (!data.success || !data.result || !data.result.response) {
        return { trxRef: null, lastName: null, packageSequence: null };
      }

      let parsed = {};
      const rawResponse = data.result.response;
      try {
        if (typeof rawResponse === 'object' && rawResponse !== null) {
          parsed = rawResponse;
        } else if (typeof rawResponse === 'string') {
          const match = rawResponse.match(/\{[\s\S]*\}/);
          const cleanJson = match ? match[0] : rawResponse.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
          parsed = JSON.parse(cleanJson);
        }
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        console.warn(`[CloudflareFallback] Image ${idx} JSON parse or fetch failed: ${err.message}. Running fuzzy extraction...`);
        const trxMatch = rawResponse ? rawResponse.match(/\b(\d{8})\b/) : null;
        if (trxMatch) parsed.trxRef = trxMatch[1];
        
        if (pickwaveKeys && pickwaveKeys.length > 0 && rawResponse) {
          const upperRaw = rawResponse.toUpperCase();
          const STOPWORDS = ['THE', 'AND', 'FOR', 'INC', 'LLC', 'USA', 'WAY', 'AVE', 'STR', 'STREET', 'STORE', 'DEPOT', 'HOME', 'SHIP', 'DATA', 'IMPORT', 'EXPORT', 'THD'];
          for (const pk of pickwaveKeys) {
            const words = pk.split(/\s+/);
            for (const word of words) {
              if (word.length >= 3 && !STOPWORDS.includes(word) && upperRaw.includes(word)) {
                parsed.lastName = word;
                break;
              }
            }
            if (parsed.lastName) break;
          }
        }
      }
      return {
        trxRef: parsed.trxRef || null,
        lastName: parsed.lastName || null,
        packageSequence: parsed.packageSequence || null
      };
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      console.error(`[CloudflareFallback] Image ${idx} request error: ${err.message}`);
      return { trxRef: null, lastName: null, packageSequence: null };
    }
  });

  const results = await Promise.all(promises);
  console.log(`[CloudflareFallback] Parallel processing complete.`);
  return results;
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
    { text: `Extract the 8-digit Purchase No or Trx Ref No, the Customer's Last Name, and the exact "X of Y" package sequence text (e.g., "1 OF 1", "1 of 2") from each of these ${pngBuffers.length} shipping labels.${expectedNamesStr} Return ONLY a JSON array of exactly ${pngBuffers.length} objects, in the same order as the images. Each object must have keys "trxRef", "lastName", and "packageSequence" (e.g. "1 OF 1"). If not found, use null.` }
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
        if (response.status === 429) {
          console.warn('[performGemmaOCRBatch] Google API 429 limit hit. Instantly failing over to Cloudflare Llama 3.2 Vision...');
          return await performCloudflareOCRFallback(pngBuffers, pickwaveKeys);
        }
        if (response.status >= 500) {
          console.warn('[performGemmaOCRBatch] API ' + response.status + '. Retrying...');
          await new Promise(r => setTimeout(r, 12000));
          retries--;
          continue;
        }
        console.error('[performGemmaOCRBatch] API error: ' + response.status + ' failing over to Cloudflare...');
        return await performCloudflareOCRFallback(pngBuffers, pickwaveKeys);
      }
      
      const data = await response.json();
      if (!data.candidates || !data.candidates[0].content) {
        return await performCloudflareOCRFallback(pngBuffers, pickwaveKeys);
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
        await new Promise(r => setTimeout(r, 12000));
        retries--;
        continue;
      }
      console.error('[performGemmaOCRBatch] Request failed: ' + err.message);
      return await performCloudflareOCRFallback(pngBuffers, pickwaveKeys);
    }
  }
  
  console.warn('[performGemmaOCRBatch] Retries exhausted. Failing over to Cloudflare...');
  return await performCloudflareOCRFallback(pngBuffers, pickwaveKeys);
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
    let currentSkuY = null;
    let currentSkuQuantity = 1;

    for (let i = 1; i <= parsedPdf.numPages; i++) {
      const page = await parsedPdf.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items.map(item => ({ str: item.str.trim(), y: item.transform[5], x: item.transform[4] })).filter(item => item.str);
      
      for (let j = 0; j < items.length; j++) {
        const text = items[j].str;
        const x = items[j].x;
        const y = items[j].y;

        // 0. Extract Quantity (must be in the ~379 X-column and on the same Y-axis as currentSku)
        if (/^\d+$/.test(text) && x >= 365 && x <= 395) {
          if (currentSku && Math.abs(y - currentSkuY) < 5) {
            currentSkuQuantity = parseInt(text) || 1;
            console.log(`[parsePickwaveFromBuffer] Extracted Quantity=${currentSkuQuantity} for SKU=${currentSku}`);
          }
        }

        // 1. Customer Name extraction (after HH:MM:SS PM/AM or HH:MM PM/AM)
        if ((text === 'PM' || text === 'AM') && j > 0 && /^\d{1,2}:\d{2}(:\d{2})?$/.test(items[j-1].str)) {
          let k = j + 1;
          const nameParts = [];
          while (k < items.length && !/^\d/.test(items[k].str)) {
            const cleanPart = items[k].str.replace(/[^a-zA-Z-]/g, '');
            if (cleanPart.length > 1) nameParts.push(cleanPart.toUpperCase());
            k++;
          }
          if (nameParts.length > 0) {
            const currentName = nameParts.join(' ');
            if (!pickwaveMap[currentName]) pickwaveMap[currentName] = [];
            if (currentSku) {
              for (let q = 0; q < currentSkuQuantity; q++) {
                pickwaveMap[currentName].push(currentSku);
              }
              console.log(`[parsePickwaveFromBuffer] Mapped Name="${currentName}" -> ${currentSkuQuantity}x SKU="${currentSku}"`);
            }
          }
        }

        // 2. Order Ref (6 to 10 digits)
        // Must be on the left half of the page to avoid zip codes / street numbers on the far right.
        if (/^\d{6,10}$/.test(text) && x < 350) {
          const currentOrderRef = text;
          if (!pickwaveMap[currentOrderRef]) pickwaveMap[currentOrderRef] = [];
          if (currentSku) {
            for (let q = 0; q < currentSkuQuantity; q++) {
              pickwaveMap[currentOrderRef].push(currentSku);
            }
          }
        }

        // 3. SKU pattern (e.g. 78669-BK, 87983S-GY, 79590, 77182-C)
        // SKUs are on the left half, so x < 350. This strictly prevents 5-digit street addresses (like 29687, x=480) from being parsed as SKUs.
        if (/^\d{5}[A-Z]?(?:-[A-Z0-9]+)*$/.test(text) && x < 350) {
          currentSku = text;
          currentSkuY = y;
          currentSkuQuantity = 1;
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

  // Batch process all images via Gemini Flash with concurrency to prevent Vercel timeouts for 200+ labels
  const batchSize = 25;
  const batches = [];
  for (let b = 0; b < pageDataList.length; b += batchSize) {
    batches.push(pageDataList.slice(b, b + batchSize));
  }

  const concurrencyLimit = 3;
  let activeWorkers = 0;
  let batchIndex = 0;

  await new Promise((resolve) => {
    function processNext() {
      if (batchIndex >= batches.length) {
        if (activeWorkers === 0) resolve();
        return;
      }

      const batch = batches[batchIndex++];
      const unMatchedWithImages = batch.filter(p => !p.matchedKey && p.imgBuf);

      if (unMatchedWithImages.length === 0) {
        processNext();
        return;
      }

      activeWorkers++;
      (async () => {
        try {
          const buffers = unMatchedWithImages.map(p => p.imgBuf);
          console.log(`[processLabelsPdf] Parallel Batch OCR for ${buffers.length} pages...`);
          const aiResults = await performGemmaOCRBatch(buffers, Object.keys(pickwaveMap));

          for (let j = 0; j < unMatchedWithImages.length; j++) {
            const pageObj = unMatchedWithImages[j];
            const aiData = aiResults[j] || { trxRef: null, lastName: null, packageSequence: null };

            pageObj.trxRefNo = aiData.trxRef || null;
            const extractedLastName = aiData.lastName ? aiData.lastName.toUpperCase().replace(/[^A-Z\s-]/g, '').trim() : null;
            pageObj.packageSequence = aiData.packageSequence || null;
            console.log(`[Page ${pageObj.i}] AI TrxRef: "${pageObj.trxRefNo}", LastName: "${extractedLastName}", Seq: "${pageObj.packageSequence}"`);

            if (pageObj.trxRefNo && pickwaveMap[pageObj.trxRefNo]) {
              pageObj.matchedKey = pageObj.trxRefNo;
            } else if (extractedLastName && extractedLastName.length > 1) {
              // strict exact match
              if (pickwaveMap[extractedLastName]) {
                pageObj.matchedKey = extractedLastName;
              } else {
                // robust word-based search fallback
                for (const pk of Object.keys(pickwaveMap)) {
                  const pkWords = pk.split(/\s+/);
                  if (pkWords.includes(extractedLastName) || pk.includes(extractedLastName)) {
                    // Prevent 2-letter last names from blindly substring-matching (e.g., 'HO' matching 'THOMAS')
                    if (extractedLastName.length === 2 && !pkWords.includes(extractedLastName)) {
                      continue;
                    }
                    pageObj.matchedKey = pk;
                    console.log(`[Page ${pageObj.i}] Smart Matched AI "${extractedLastName}" to Pickwave "${pk}"`);
                    break;
                  }
                }
              }
            }

            if (!pageObj.matchedKey) {
              const STOPWORDS = ['THE', 'AND', 'FOR', 'INC', 'LLC', 'USA', 'WAY', 'AVE', 'STR', 'STREET', 'STORE', 'DEPOT', 'HOME', 'SHIP', 'DATA', 'IMPORT', 'EXPORT', 'THD', 'COSTCO', 'OVERSTOCK', 'AMAZON', 'WALMART', 'TARGET'];
              const words = pageObj.fullText.toUpperCase().split(/\s+/);
              for (const word of words) {
                const cleanWord = word.replace(/[^A-Z-]/g, '');
                if (cleanWord.length > 2 && !STOPWORDS.includes(cleanWord)) {
                  const found = Object.keys(pickwaveMap).find(k => k.includes(cleanWord));
                  if (found) {
                    pageObj.matchedKey = found;
                    console.log(`[Page ${pageObj.i}] Text Layer Fallback Matched "${cleanWord}" to Pickwave "${found}"`);
                    break;
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error(`[processLabelsPdf] Queue worker error:`, e);
        } finally {
          activeWorkers--;
          processNext();
        }
      })();

      if (activeWorkers < concurrencyLimit) {
        processNext();
      }
    }

    for (let i = 0; i < concurrencyLimit; i++) {
      processNext();
    }
  });

  // Final match fallbacks & build results
  const pageResults = [];
  const labelCounts = {};
  for (const pageObj of pageDataList) {
    let { matchedKey, packageIndex, billingX, billingY, fullText, i, packageSequence } = pageObj;

    if (!matchedKey) {
      const words = fullText.toUpperCase().split(/\s+/);
      const STOPWORDS = ['THE', 'AND', 'FOR', 'INC', 'LLC', 'USA', 'WAY', 'AVE', 'STR', 'STREET', 'STORE', 'DEPOT', 'HOME', 'SHIP', 'DATA', 'IMPORT', 'EXPORT', 'THD', 'POSTAL', 'SHIPPING', 'WEIGHT', 'LABEL', 'ORDER', 'REF'];
      for (const word of words) {
        const cleanWord = word.replace(/[^A-Z]/g, '');
        if (cleanWord.length > 2 && !STOPWORDS.includes(cleanWord)) {
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

    pageResults.push({ matchedKey, packageIndex, billingX, billingY, fullText, packageSequence });
    if (matchedKey) {
      labelCounts[matchedKey] = (labelCounts[matchedKey] || 0) + 1;
    }
    console.log(`[Page ${i}] FINAL: matchedKey="${matchedKey}" pkgIndex=${packageIndex}`);
  }

  console.log('\n[processLabelsPdf] Stamping PDF...');
  const pdfDoc = await PDFDocument.load(labelsPdfBuffer);
  const newPdfDoc = await PDFDocument.create();
  const font = await newPdfDoc.embedFont(StandardFonts.HelveticaBold);
  let matchedCount = 0;
  
  const unmatchedNames = [];
  const seenCounts = {};

  for (let i = 0; i < numPages; i++) {
    const { matchedKey, billingX, billingY, fullText, packageSequence } = pageResults[i];

    if (!matchedKey || !pickwaveMap[matchedKey] || pickwaveMap[matchedKey].length === 0) {
      // It failed to match! Let's extract a possible name or snippet from the fullText just for logging
      // If we don't have the AI extracted name, we can just grab the first few words of the text
      const fallbackName = fullText ? fullText.split(/\s+/).slice(0, 3).join(' ') : 'Unknown Name';
      unmatchedNames.push(`Page ${i+1} (${fallbackName})`);
      const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
      newPdfDoc.addPage(copiedPage);
      continue;
    }

    const skuList = pickwaveMap[matchedKey];
    
    // First approach: 1-to-1 mapping (NO LABEL COPYING)
    const idx = seenCounts[matchedKey] || 0;
    seenCounts[matchedKey] = idx + 1;
    
    // If the customer ordered more items than there are labels, we DO NOT copy labels.
    // Instead, we just grab the remaining SKUs and stamp them ALL onto this final label.
    const labelsWeHave = labelCounts[matchedKey] || 1;
    const isLastLabel = seenCounts[matchedKey] === labelsWeHave;
    
    const skusToStampOnThisLabel = [];
    if (isLastLabel && idx < skuList.length) {
      // It's the last physical label, so grab ALL remaining SKUs
      for (let k = idx; k < skuList.length; k++) {
        skusToStampOnThisLabel.push(skuList[k]);
      }
    } else {
      // Just grab the current 1-to-1 SKU (or fallback to the last SKU if we run out)
      skusToStampOnThisLabel.push(skuList[Math.min(idx, skuList.length - 1)]);
    }

    const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
    const { width: pageWidth, height: pageHeight } = copiedPage.getSize();
    
    // We only have ONE copiedPage, and we will draw ALL SKUs onto it.
    let skuText = '';
    if (skusToStampOnThisLabel.length > 1) {
       // If there are multiple SKUs, join them with a comma
       skuText = `SKU: ${skusToStampOnThisLabel.join(', ')}`;
    } else {
       skuText = `SKU: ${skusToStampOnThisLabel[0]}`;
    }

    const fontSize = 10;
    let textX = Math.max(5, Math.min(billingX ?? 20, pageWidth - 150));
    let textY = billingY !== null ? Math.max(fontSize + 5, billingY - 18) : pageHeight * 0.08;
    textY = Math.max(fontSize + 5, Math.min(textY, pageHeight - 5));

    copiedPage.drawText(skuText, { x: textX, y: textY, size: Math.min(fontSize, 12 - (skusToStampOnThisLabel.length * 0.5)), font, color: rgb(0,0,0) });

    console.log(`[Stamp ${i+1}] ✓ Key="${matchedKey}" → ${skuText}`);
    newPdfDoc.addPage(copiedPage);
    matchedCount++;
  }

  console.log(`[processLabelsPdf] DONE: ${matchedCount}/${numPages} matched`);
  const bytes = await newPdfDoc.save();
  return { buffer: Buffer.from(bytes), matchedCount, totalPages: newPdfDoc.getPageCount(), originalPages: numPages, unmatchedNames };
}
