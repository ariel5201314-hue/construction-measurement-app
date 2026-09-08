import { calculateReport, formatReport, parseSpokenMeasurement } from './calculator.js';
import { createAnnotationSnapshot, createPhotoSnapshot, loadDraft, saveDraft } from './storage.js';

const defaults = { cSteel: '', thickness: 30, sealant: 15, notes: '' };
const state = { photoDataUrl: '', lines: [], selectedId: null, drawing: null, drawMode: false };
const history = [];
const photoInputs = [...document.querySelectorAll('#camera-input, #gallery-input')];
const stage = document.querySelector('#photo-stage');
const photo = document.querySelector('#photo');
const canvas = document.querySelector('#annotation-canvas');
const context = canvas.getContext('2d');
const fields = Object.fromEntries(['cSteel', 'thickness', 'sealant', 'notes'].map((name) => [name, document.querySelector(`#${name === 'cSteel' ? 'c-steel' : name}`)]));
const selectedLine = document.querySelector('#selected-line');
const formula = document.querySelector('#formula');
const result = document.querySelector('#result');
const voiceStatus = document.querySelector('#voice-status');
const saveStatus = document.querySelector('#save-status');
const exportButton = document.querySelector('#export-annotated');
const drawButton = document.querySelector('#draw-line');
const undoButton = document.querySelector('#undo-action');
const deleteButton = document.querySelector('#delete-line');
const voiceButton = document.querySelector('#voice-button');
const drawHint = document.querySelector('#draw-hint');
const tabs = [...document.querySelectorAll('[role="tab"]')];
let saveTimer;
let renderFrame;
let dictationStartNotes = null;

function selected() { return state.lines.find((line) => line.id === state.selectedId); }
function annotationSnapshot() {
  return {
    lines: state.lines.map((line) => ({ ...line, a: { ...line.a }, b: { ...line.b } })),
    selectedId: state.selectedId,
  };
}
function remember() {
  history.push(annotationSnapshot());
  if (history.length > 20) history.shift();
}
function updateControls() {
  const hasPhoto = Boolean(state.photoDataUrl);
  drawButton.disabled = !hasPhoto;
  drawButton.classList.toggle('active', state.drawMode);
  drawButton.setAttribute('aria-pressed', String(state.drawMode));
  drawButton.setAttribute('aria-label', state.drawMode ? '取消畫線' : '畫尺寸線');
  drawButton.title = state.drawMode ? '取消畫線' : '畫尺寸線';
  undoButton.disabled = history.length === 0;
  deleteButton.disabled = !selected();
  voiceButton.disabled = !selected();
  canvas.classList.toggle('drawing-mode', state.drawMode);
  drawHint.textContent = !hasPhoto
    ? '請先拍照或選取照片。'
    : state.drawMode
      ? '畫線模式：在照片上按住拖曳；再點橘色圖示可取消。'
      : '點畫線圖示後再拖曳；直接點既有線可選取修改。';
}
function showPhoto(source) {
  photo.src = source;
  stage.classList.remove('empty');
  exportButton.disabled = false;
  photo.onload = () => {
    resizeCanvas();
    updateControls();
  };
}
async function persistDraft() {
  try {
    await saveDraft({ photo: createPhotoSnapshot(state), annotation: createAnnotationSnapshot(state) });
    saveStatus.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    saveStatus.textContent = '儲存失敗，請勿關閉畫面';
  }
}
function queueSave() {
  saveStatus.textContent = '儲存中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistDraft, 250);
}
function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  render();
}
function point(event) {
  const box = canvas.getBoundingClientRect();
  return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
}
function lineDistance(pointValue, line) {
  const x = pointValue.x * canvas.clientWidth; const y = pointValue.y * canvas.clientHeight;
  const ax = line.a.x * canvas.clientWidth; const ay = line.a.y * canvas.clientHeight;
  const bx = line.b.x * canvas.clientWidth; const by = line.b.y * canvas.clientHeight;
  const length = Math.hypot(bx - ax, by - ay) || 1;
  return Math.abs((by - ay) * x - (bx - ax) * y + bx * ay - by * ax) / length;
}
function drawLine(line, active, targetContext = context, width = canvas.clientWidth, height = canvas.clientHeight) {
  const a = { x: line.a.x * width, y: line.a.y * height }; const b = { x: line.b.x * width, y: line.b.y * height };
  targetContext.strokeStyle = active ? '#ffe36e' : '#12d5e8'; targetContext.fillStyle = '#102f3b'; targetContext.lineWidth = active ? 5 : 3;
  targetContext.beginPath(); targetContext.moveTo(a.x, a.y); targetContext.lineTo(b.x, b.y); targetContext.stroke();
  [a, b].forEach((p) => { targetContext.beginPath(); targetContext.arc(p.x, p.y, 5, 0, Math.PI * 2); targetContext.fillStyle = '#fff'; targetContext.fill(); targetContext.stroke(); });
  if (!calculateReport(line)) return;
  const label = `${formatReport(line)} mm`;
  targetContext.font = `600 ${Math.max(13, width / 55)}px system-ui`; const textWidth = targetContext.measureText(label).width;
  const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2 - 12;
  const labelX = Math.min(Math.max(x - textWidth / 2 - 6, 4), Math.max(4, width - textWidth - 16));
  const labelY = Math.min(Math.max(y - 15, 4), height - 26);
  targetContext.fillStyle = '#102f3bdd'; targetContext.fillRect(labelX, labelY, textWidth + 12, 22); targetContext.fillStyle = '#fff'; targetContext.fillText(label, labelX + 6, labelY + 16);
}
function render() {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  state.lines.forEach((line) => drawLine(line, line.id === state.selectedId));
  if (state.drawing) drawLine({ ...defaults, a: state.drawing.a, b: state.drawing.b }, true);
}
function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
}
function updatePanel() {
  const line = selected();
  const disabled = !line;
  Object.entries(fields).forEach(([key, field]) => { field.disabled = disabled; field.value = line?.[key] ?? defaults[key]; });
  selectedLine.textContent = line ? `正在編輯照片尺寸線 ${state.lines.indexOf(line) + 1}` : '請按「畫尺寸線」，或點選照片上的既有線。';
  const calculation = line && calculateReport(line);
  formula.textContent = line ? formatReport(line) : '尚未建立尺寸線';
  result.textContent = calculation ? `${calculation.result} mm` : '— mm';
  document.querySelector('#sketch-c').textContent = calculation ? `${line.cSteel} mm` : '—';
  document.querySelector('#sketch-t').textContent = calculation ? `板厚 +${line.thickness}` : '板厚 —';
  document.querySelector('#sketch-s').textContent = calculation ? `縫 -${line.sealant}` : '縫 —';
  document.querySelector('#sketch-result').textContent = calculation ? `${calculation.result} mm` : '—';
  updateControls();
}
function addLine(a, b) {
  remember();
  const id = crypto.randomUUID();
  state.lines.push({ id, a, b, ...defaults }); state.selectedId = id; state.drawMode = false;
  updatePanel(); render(); queueSave();
}

function handlePhotoChange(event) {
  const input = event.currentTarget;
  const file = event.target.files[0]; if (!file) return;
  if (state.photoDataUrl && !window.confirm('更換照片會清除目前這張照片的尺寸線與報數，確定要更換嗎？')) {
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.photoDataUrl = String(reader.result);
    state.lines = []; state.selectedId = null; state.drawing = null; state.drawMode = false; history.length = 0;
    input.value = '';
    showPhoto(state.photoDataUrl); updatePanel(); queueSave();
  };
  reader.onerror = () => { saveStatus.textContent = '照片讀取失敗，請重新選擇'; };
  reader.readAsDataURL(file);
}
photoInputs.forEach((input) => input.addEventListener('change', handlePhotoChange));
canvas.addEventListener('pointerdown', (event) => {
  if (stage.classList.contains('empty')) return;
  const p = point(event);
  if (state.drawMode) {
    event.preventDefault();
    state.drawing = { a: p, b: p }; canvas.setPointerCapture(event.pointerId); updateControls(); return;
  }
  const hit = state.lines.find((line) => lineDistance(p, line) < 18);
  if (hit) { state.selectedId = hit.id; updatePanel(); render(); return; }
  state.selectedId = null; updatePanel(); render();
});
canvas.addEventListener('pointermove', (event) => {
  if (!state.drawing) return;
  const samples = event.getCoalescedEvents?.();
  state.drawing.b = point(samples?.at(-1) ?? event);
  scheduleRender();
});
canvas.addEventListener('pointerup', (event) => {
  if (!state.drawing) return;
  const { a, b } = state.drawing; state.drawing = null;
  if (Math.hypot(a.x - b.x, a.y - b.y) > .03) addLine(a, b); else render();
});
canvas.addEventListener('pointercancel', () => { state.drawing = null; render(); updateControls(); });
Object.entries(fields).forEach(([key, field]) => field.addEventListener('input', () => {
  const line = selected(); if (!line) return;
  if (field.dataset.historySaved !== 'true') { remember(); field.dataset.historySaved = 'true'; }
  if (key === 'notes' && field.dataset.voiceMeasurement === 'true') {
    const measurement = parseSpokenMeasurement(field.value.slice(dictationStartNotes?.length ?? 0));
    if (measurement) {
      Object.assign(line, measurement); line.notes = dictationStartNotes ?? '';
      field.dataset.voiceMeasurement = 'false'; dictationStartNotes = null;
      updatePanel(); render(); queueSave(); voiceStatus.textContent = `已填入照片尺寸：${formatReport(line)}`; return;
    }
  }
  line[key] = field.value;
  updatePanel(); render(); queueSave();
}));
Object.values(fields).forEach((field) => {
  field.addEventListener('focus', () => { field.dataset.historySaved = 'false'; });
  field.addEventListener('blur', () => { field.dataset.historySaved = 'false'; if (field === fields.notes) { field.dataset.voiceMeasurement = 'false'; dictationStartNotes = null; } });
});
drawButton.addEventListener('click', () => {
  state.drawMode = !state.drawMode; state.drawing = null; render(); updateControls();
});
undoButton.addEventListener('click', () => {
  const previous = history.pop(); if (!previous) return;
  state.lines = previous.lines; state.selectedId = previous.selectedId; state.drawing = null; state.drawMode = false;
  updatePanel(); render(); queueSave();
});
deleteButton.addEventListener('click', () => {
  const line = selected(); if (!line) return;
  remember();
  const index = state.lines.indexOf(line);
  state.lines = state.lines.filter((item) => item.id !== line.id);
  state.selectedId = state.lines[Math.min(index, state.lines.length - 1)]?.id ?? null;
  updatePanel(); render(); queueSave();
});
tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((item) => {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
    document.querySelector(`#${item.getAttribute('aria-controls')}`).hidden = !active;
  });
  if (tab.id === 'measure-tab') requestAnimationFrame(resizeCanvas);
}));
function useKeyboardDictation() {
  dictationStartNotes = fields.notes.value;
  fields.notes.dataset.voiceMeasurement = 'true';
  fields.notes.focus();
  fields.notes.setSelectionRange(fields.notes.value.length, fields.notes.value.length);
  voiceStatus.textContent = '請按鍵盤麥克風，念「536 加 30 減 15」。';
}
function applyVoiceText(text) {
  const line = selected(); if (!line) return;
  const measurement = parseSpokenMeasurement(text); remember();
  if (measurement) {
    Object.assign(line, measurement); updatePanel(); render(); queueSave(); voiceStatus.textContent = `已填入照片尺寸：${formatReport(line)}`; return;
  }
  line.notes = [line.notes, text].filter(Boolean).join('\n'); updatePanel(); queueSave(); voiceStatus.textContent = `已加入備註：${text}`;
}
voiceButton.addEventListener('click', () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!selected()) { voiceStatus.textContent = '請先選取照片上的尺寸線。'; return; }
  if (!Recognition) { useKeyboardDictation(); return; }
  const recognition = new Recognition(); recognition.lang = 'zh-TW'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  voiceStatus.textContent = '正在聆聽…';
  recognition.onresult = (event) => applyVoiceText(event.results[0][0].transcript);
  recognition.onerror = useKeyboardDictation;
  try { recognition.start(); } catch { useKeyboardDictation(); }
});
exportButton.addEventListener('click', () => {
  if (!state.photoDataUrl) return;
  const source = new Image();
  source.onload = () => {
    const output = document.createElement('canvas');
    output.width = source.naturalWidth; output.height = source.naturalHeight;
    const outputContext = output.getContext('2d');
    outputContext.drawImage(source, 0, 0);
    state.lines.forEach((line) => drawLine(line, false, outputContext, output.width, output.height));
    output.toBlob((blob) => {
      if (!blob) { saveStatus.textContent = '標註照片輸出失敗，請再試一次'; return; }
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url; link.download = '工地丈量-標註照片.png';
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      saveStatus.textContent = '已輸出標註照片；原始照片仍保留';
    }, 'image/png');
  };
  source.src = state.photoDataUrl;
});
async function restoreOnStart() {
  try {
    const draft = await loadDraft();
    if (!draft) return;
    state.photoDataUrl = draft.photoDataUrl;
    state.lines = draft.lines;
    state.selectedId = draft.selectedId;
    state.drawing = null; state.drawMode = false; history.length = 0;
    if (state.photoDataUrl) showPhoto(state.photoDataUrl);
    saveStatus.textContent = '已恢復上次紀錄';
  } catch {
    saveStatus.textContent = '無法讀取上次紀錄';
  }
}

window.addEventListener('resize', resizeCanvas);
await restoreOnStart(); updatePanel(); render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
}
