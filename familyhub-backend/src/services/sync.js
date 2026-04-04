const { v4: uuidv4 } = require('uuid');
const driveService = require('./drive');
const classifier = require('./classifier');
const firestoreService = require('./firestore');

// Process items with a concurrency limit to avoid overwhelming APIs
async function asyncPool(concurrency, items, fn) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

async function runSync() {
  const result = { processed: 0, skipped: 0, errors: [] };

  try {
    // Load family knowledge base for smarter classification
    const knowledge = await firestoreService.getAllKnowledge();
    if (knowledge.length > 0) {
      console.log(`Loaded ${knowledge.length} family knowledge entries for classification`);
    }

    const allFiles = [];
    let pageToken = null;

    do {
      const page = await driveService.listFiles(pageToken);
      allFiles.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);

    console.log(`Drive returned ${allFiles.length} files`);

    // Pre-filter files: check existence and support in parallel batches
    const toProcess = [];
    for (const file of allFiles) {
      const exists = await firestoreService.manifestExists(file.id);
      if (exists) {
        result.skipped++;
        continue;
      }

      const wasDeleted = await firestoreService.isDeleted(file.id);
      if (wasDeleted) {
        result.skipped++;
        continue;
      }

      if (!driveService.isSupportedType(file.mimeType)) {
        console.log(`Skipping unsupported type: ${file.mimeType} (${file.name})`);
        result.skipped++;
        continue;
      }

      toProcess.push(file);
    }

    console.log(`${toProcess.length} files to process (${result.skipped} skipped)`);

    // Process files with concurrency limit of 3 (balances speed vs API rate limits)
    await asyncPool(3, toProcess, async (file) => {
      try {
        console.log(`Processing: ${file.name} (${file.mimeType})`);
        const { buffer, mimeType } = await driveService.downloadFile(file.id, file.mimeType);

        // Extract EXIF from file bytes + Drive metadata (bytes take priority)
        const exif = await classifier.extractExif(file.imageMediaMetadata, buffer, mimeType);
        if (exif) {
          console.log(`  EXIF: ${JSON.stringify(exif)}`);
        }

        const classification = await classifier.classifyFile(buffer, mimeType, file.name, { exif, knowledge });

        const manifest = {
          id: uuidv4(),
          driveFileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType,
          fileSize: parseInt(file.size, 10) || 0,
          driveCreatedTime: file.createdTime,
          driveModifiedTime: file.modifiedTime,
          thumbnailLink: file.thumbnailLink || null,
          webViewLink: file.webViewLink || null,
          exif: exif || null,
          classification,
          corrections: null,
          createdAt: new Date().toISOString(),
        };

        await firestoreService.writeManifest(manifest);
        result.processed++;
        console.log(`Classified and stored: ${file.name} -> ${classification.category}`);
      } catch (fileErr) {
        console.error(`Error processing ${file.name}:`, fileErr.message);
        result.errors.push({ file: file.name, error: fileErr.message });
      }
    });

    await firestoreService.updateSyncCursor({ lastFileCount: allFiles.length });
    console.log(`Sync complete: ${result.processed} processed, ${result.skipped} skipped, ${result.errors.length} errors`);
  } catch (err) {
    console.error('Sync failed:', err);
    result.errors.push({ file: 'SYNC_GLOBAL', error: err.message });
  }

  return result;
}

module.exports = { runSync };
