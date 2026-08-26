import { getStorageClient } from './src/modules/documents/storage.js';
import { loadEnv } from './src/config/env.js';

async function main() {
  await loadEnv();
  const storage = await getStorageClient();
  try {
    const pdf = await storage.download('templates/Personalfragebogen_NEU.pdf');
    console.log('Success! Downloaded bytes:', pdf.length);
  } catch (e) {
    console.error('Error downloading:', e);
  }
}
main();
