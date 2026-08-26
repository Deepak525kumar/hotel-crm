import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getStorageClient } from '../modules/documents/storage.js';
import { loadEnv } from '../config/env.js';

async function main() {
  await loadEnv();
  const filePath = resolve(process.cwd(), '..', 'Personalfragebogen_NEU.pdf');
  console.log(`Reading contract template from ${filePath}...`);
  
  const buffer = await readFile(filePath);
  
  const storage = await getStorageClient();
  const key = 'templates/Personalfragebogen_NEU.pdf';
  
  console.log(`Uploading to S3 with key: ${key}...`);
  await storage.upload(key, buffer, 'application/pdf');
  
  console.log('Upload complete!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
