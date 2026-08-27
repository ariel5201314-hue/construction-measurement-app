const DATABASE_NAME = 'construction-measurement-app';
const PHOTO_STORE = 'photos';
const ANNOTATION_STORE = 'annotations';
const CURRENT_DRAFT = 'current';

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function createPhotoSnapshot(state) {
  return {
    id: CURRENT_DRAFT,
    photoDataUrl: typeof state.photoDataUrl === 'string' ? state.photoDataUrl : '',
    updatedAt: new Date().toISOString(),
  };
}

export function createAnnotationSnapshot(state) {
  return {
    id: CURRENT_DRAFT,
    version: 2,
    lines: state.lines.map(({ id, a, b, cSteel, thickness, sealant, notes }) => ({
      id, a: { ...a }, b: { ...b }, cSteel, thickness, sealant, notes,
    })),
    selectedId: state.selectedId,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeDraft(draft) {
  if (!draft || typeof draft !== 'object') return null;
  const lines = Array.isArray(draft.lines)
    ? draft.lines.filter((line) => line?.id && validPoint(line.a) && validPoint(line.b))
    : [];
  return {
    photoDataUrl: typeof draft.photoDataUrl === 'string' ? draft.photoDataUrl : '',
    lines,
    selectedId: lines.some((line) => line.id === draft.selectedId) ? draft.selectedId : lines[0]?.id ?? null,
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PHOTO_STORE)) database.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(ANNOTATION_STORE)) database.createObjectStore(ANNOTATION_STORE, { keyPath: 'id' });

      if (event.oldVersion < 2 && database.objectStoreNames.contains('drafts')) {
        const transaction = request.transaction;
        const legacyDraft = transaction.objectStore('drafts').get(CURRENT_DRAFT);
        legacyDraft.onsuccess = () => {
          const draft = legacyDraft.result;
          if (!draft) return;
          transaction.objectStore(PHOTO_STORE).put({ id: CURRENT_DRAFT, photoDataUrl: draft.photoDataUrl || '', updatedAt: draft.updatedAt });
          transaction.objectStore(ANNOTATION_STORE).put({
            id: CURRENT_DRAFT, version: 2, lines: draft.lines || [], selectedId: draft.selectedId, updatedAt: draft.updatedAt,
          });
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, storeNames, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, mode);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    action(transaction);
  });
}

export function saveDraft({ photo, annotation }) {
  return run('readwrite', [PHOTO_STORE, ANNOTATION_STORE], (transaction) => {
    transaction.objectStore(PHOTO_STORE).put(photo);
    transaction.objectStore(ANNOTATION_STORE).put(annotation);
  });
}

export async function loadDraft() {
  let photo;
  let annotation;
  await run('readonly', [PHOTO_STORE, ANNOTATION_STORE], (transaction) => {
    const photoRequest = transaction.objectStore(PHOTO_STORE).get(CURRENT_DRAFT);
    const annotationRequest = transaction.objectStore(ANNOTATION_STORE).get(CURRENT_DRAFT);
    photoRequest.onsuccess = () => { photo = photoRequest.result; };
    annotationRequest.onsuccess = () => { annotation = annotationRequest.result; };
  });
  return normalizeDraft({ ...annotation, photoDataUrl: photo?.photoDataUrl });
}
