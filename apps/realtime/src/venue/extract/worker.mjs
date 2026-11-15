// Worker-thread entry (see ../extract.ts): one document in, one result out, then the thread ends. It has
// no access to the request, the database or the configuration: only the bytes and the limits.
import { parentPort, workerData } from 'node:worker_threads';
import { extractDocument } from './core.mjs';

try {
  const { bytes, fileName, limits } = workerData;
  parentPort.postMessage(await extractDocument(new Uint8Array(bytes), fileName, limits));
} catch {
  parentPort.postMessage({ ok: false, code: 'corrupt' });
}
