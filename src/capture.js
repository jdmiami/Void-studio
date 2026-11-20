const databaseName = 'void-studio';
const storeName = 'takes';
let connection;

function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

async function transact(mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}

export const getTakes = () => transact('readonly', store => store.getAll());
export const saveTake = take => transact('readwrite', store => store.put(take));
export const removeTake = id => transact('readwrite', store => store.delete(id));

export function makeRecorder(stream, bitrate) {
  if (!globalThis.MediaRecorder) throw new Error('This browser cannot record video.');
  let recorder;
  const types = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const mimeType of types) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
      break;
    } catch {
      // The browser may support the codec with a different combination of tracks.
    }
  }
  recorder ||= new MediaRecorder(stream);
  const chunks = [];
  const result = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = event => reject(event.error || new Error('Recording was interrupted.'));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'video/webm' });
      if (blob.size) resolve(blob);
      else reject(new Error('The recording was empty. Try a longer take.'));
    };
  });
  result.catch(() => {});
  return { recorder, result };
}

export function canvasStream(canvas, fps, audioTracks = []) {
  if (!canvas.captureStream) throw new Error('This browser cannot capture the effects layer.');
  const stream = canvas.captureStream(fps);
  audioTracks.forEach(track => stream.addTrack(track));
  return stream;
}

export async function downloadBlob(blob, basename) {
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const filename = `${basename}.${extension}`;
  const android = globalThis.VoidAndroid;
  if (android) {
    const download = android.beginDownload(filename, `video/${extension}`);
    if (!download) throw new Error('Could not open Downloads for this video.');
    let complete = false;
    try {
      const chunkSize = 192 * 1024;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const chunk = blob.slice(offset, offset + chunkSize);
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(chunk);
        });
        if (!android.appendDownload(download, data)) throw new Error('The video could not be written to Downloads.');
      }
      complete = true;
    } finally {
      const saved = android.finishDownload(download, complete);
      if (complete && !saved) throw new Error('The video could not be saved to Downloads.');
    }
    return;
  }
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 45000);
}

export function frameAt(events, ms) {
  if (!events.length) return null;
  let start = 0;
  let end = events.length - 1;
  while (start < end) {
    const mid = Math.ceil((start + end) / 2);
    if (events[mid].at <= ms) start = mid;
    else end = mid - 1;
  }
  return events[start];
}
