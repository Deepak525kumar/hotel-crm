import * as WebBrowser from 'expo-web-browser';
import type { WorkerDocument } from '@hotel-crm/mobile-shared';

/**
 * Opens a document for viewing. Takes the full `WorkerDocument`, not just a
 * URL, so a future download-then-preview implementation (filename, mime
 * type, local caching) can be swapped in without changing any caller.
 */
export async function openDocument(document: WorkerDocument): Promise<void> {
  if (!document.presigned_url) return;
  await WebBrowser.openBrowserAsync(document.presigned_url);
}
