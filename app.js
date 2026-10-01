import { calculateReport, formatReport, parseSpokenMeasurement } from './calculator.js?v=10';
import { createAnnotationSnapshot, createPhotoSnapshot, loadDraft, saveDraft } from './storage.js?v=10';

const defaults = { cSteel: '', measurementExpression: '', thickness: 30, sealant: 15, notes: '' };
const state = { photoDataUrl: '', lines: [], selectedId: null, drawing: null, chainPoint: null, drawMode: false };
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
const lDrawButton = document.querySelector('#draw-l-line');
const undoButton = document.querySelector('#undo-action');
const deleteButton = document.querySelector('#delete-line');
const voiceButton = document.querySelector('#voice-button');
const drawHint = document.querySelector('#draw-hint');
const measurementList = document.querySelector('#measurement-list');
const tabs = [...document.querySelectorAll('[role="tab"]')];
let saveTimer;
let renderFrame;
let dictationStartNotes = null;
let activeRecognition = null;

function selected() { return state.lines.find((line) => line.id === state.selectedId); }
function lineTypeText(line) { return line.type === 'chain' ? '轉角線' : line.type === 'l' ? 'L 型線' : '直線'; }
function measurementText(line) {
  const measured = line.cSteel === '' ? null : Number(line.cSteel);
  if (!Number.isFinite(measured)) return null;
  return line.measurementExpression ? `${line.measurementExpression} = ${measured}` : `${measured}`;
}
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
  lDrawButton.disabled = !hasPhoto;
  for (const [button, mode, label] of [[drawButton, 'straight', '直線'], [lDrawButton, 'chain', '連續轉角線']]) {
    const active = state.drawMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? `結束${label}` : `畫${label}`);
    button.title = active ? `結束${label}` : `畫${label}`;
  }
  undoButton.disabled = history.length === 0;
  deleteButton.disabled = !selected();
  voiceButton.disabled = !selected();
  canvas.classList.toggle('drawing-mode', state.drawMode);
  drawHint.textContent = !hasPhoto
    ? '請先拍照或選取照片。'
    : state.drawMode === 'chain'
      ? state.chainPoint
        ? '轉折模式：接著按住拉下一段，放開後可繼續多折；再按橘色圖示結束。'
        : '轉折模式：按住拉第一段，放開後接著拉下一段；也可連續點選轉折點。'
      : state.drawMode
        ? '直線模式：在照片上按住拖曳；再點橘色圖示可取消。'
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
  const points = line.type === 'l' ? [[ax, ay], [ax, by], [bx, by]] : [[ax, ay], [bx, by]];
  return Math.min(...points.slice(1).map(([px, py], index) => {
    const [qx, qy] = points[index]; const dx = px - qx; const dy = py - qy;
    const t = Math.max(0, Math.min(1, ((x - qx) * dx + (y - qy) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (qx + t * dx), y - (qy + t * dy));
  }));
}
function drawLine(line, active, targetContext = context, width = canvas.clientWidth, height = canvas.clientHeight) {
  const a = { x: line.a.x * width, y: line.a.y * height }; const b = { x: line.b.x * width, y: line.b.y * height };
  targetContext.strokeStyle = active ? '#ffe36e' : '#12d5e8'; targetContext.fillStyle = '#102f3b'; targetContext.lineWidth = active ? 5 : 3;
  targetContext.beginPath(); targetContext.moveTo(a.x, a.y); if (line.type === 'l') targetContext.lineTo(a.x, b.y); targetContext.lineTo(b.x, b.y); targetContext.stroke();
  [a, b].forEach((p) => { targetContext.beginPath(); targetContext.arc(p.x, p.y, 5, 0, Math.PI * 2); targetContext.fillStyle = '#fff'; targetContext.fill(); targetContext.stroke(); });
  const measurement = measurementText(line);
  const number = line.number ?? state.lines.indexOf(line) + 1;
  const label = measurement ? `${number}　${measurement} mm` : `${number}`;
  targetContext.font = `600 ${Math.max(13, width / 55)}px system-ui`; const textWidth = targetContext.measureText(label).width;
  const x = (a.x + b.x) / 2; const y = (a.y + b.y) / 2 - 12;
  const labelX = Math.min(Math.max(x - textWidth / 2 - 6, 4), Math.max(4, width - textWidth - 16));
  const labelY = Math.min(Math.max(y - 15, 4), height - 26);
  targetContext.fillStyle = '#102f3bdd'; targetContext.fillRect(labelX, labelY, textWidth + 12, 22); targetContext.fillStyle = '#fff'; targetContext.fillText(label, labelX + 6, labelY + 16);
}
function drawChainAnchor(pointValue) {
  context.beginPath(); context.arc(pointValue.x * canvas.clientWidth, pointValue.y * canvas.clientHeight, 7, 0, Math.PI * 2);
  context.fillStyle = '#ffe36e'; context.fill(); context.strokeStyle = '#102f3b'; context.lineWidth = 2; context.stroke();
}
function render() {
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  state.lines.forEach((line) => drawLine(line, line.id === state.selectedId));
  if (state.drawing) drawLine({ ...defaults, number: state.lines.length + 1, type: state.drawMode, a: state.drawing.a, b: state.drawing.b }, true);
  if (state.drawMode === 'chain' && state.chainPoint) drawChainAnchor(state.chainPoint);
}
function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
}
function updatePanel() {
  const line = selected();
  const disabled = !line;
  measurementList.replaceChildren(...state.lines.map((item, index) => {
    const row = document.createElement('button'); row.type = 'button'; row.className = `measurement-row${item.id === state.selectedId ? ' active' : ''}`;
    const number = item.number ?? index + 1; const measured = measurementText(item); const value = measured ? `${measured} mm` : '未輸入尺寸';
    row.innerHTML = `<span class="measurement-number">${number}</span><span>${lineTypeText(item)}</span><span class="measurement-value">${value}</span>`;
    row.addEventListener('click', () => { state.selectedId = item.id; updatePanel(); render(); });
    return row;
  }));
  Object.entries(fields).forEach(([key, field]) => {
    field.disabled = disabled;
    field.value = key === 'cSteel' && line?.measurementExpression ? line.measurementExpression : line?.[key] ?? defaults[key];
  });
  selectedLine.textContent = line ? `正在編輯 ${line.number ?? state.lines.indexOf(line) + 1} 號${lineTypeText(line)}` : '請按畫線圖示，或點選照片／清單中的既有線。';
  const calculation = line && calculateReport(line);
  formula.textContent = line ? formatReport(line) : '尚未建立尺寸線';
  result.textContent = calculation ? `${calculation.result} mm` : '— mm';
  document.querySelector('#sketch-c').textContent = calculation ? `${line.cSteel} mm` : '—';
  document.querySelector('#sketch-t').textContent = calculation ? `板厚 +${line.thickness}` : '板厚 —';
  document.querySelector('#sketch-s').textContent = calculation ? `縫 -${line.sealant}` : '縫 —';
  document.querySelector('#sketch-result').textContent = calculation ? `${calculation.result} mm` : '—';
  updateControls();
}
function addLine(a, b, keepMode = false) {
  remember();
  const id = crypto.randomUUID();
  const number = Math.max(0, ...state.lines.map((line, index) => line.number ?? index + 1)) + 1;
  state.lines.push({ id, number, type: state.drawMode, a, b, ...defaults }); state.selectedId = id;
  if (keepMode) state.chainPoint = b; else { state.drawMode = false; state.chainPoint = null; }
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
    state.lines = []; state.selectedId = null; state.drawing = null; state.chainPoint = null; state.drawMode = false; history.length = 0;
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
  if (state.drawMode === 'chain') {
    event.preventDefault();
    state.drawing = { a: state.chainPoint ?? p, b: p };
    canvas.setPointerCapture(event.pointerId); updateControls(); render(); return;
  }
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
  if (state.drawMode === 'chain') {
    if (!state.drawing) return;
    event.preventDefault();
    const p = point(event);
    const { a } = state.drawing; state.drawing = null;
    if (Math.hypot(a.x - p.x, a.y - p.y) > .015) addLine(a, p, true);
    else { state.chainPoint ??= p; updateControls(); render(); }
    return;
  }
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
      Object.assign(line, measurement); line.measurementExpression = measurement.measurementExpression ?? ''; line.notes = dictationStartNotes ?? '';
      field.dataset.voiceMeasurement = 'false'; dictationStartNotes = null;
      updatePanel(); render(); queueSave(); voiceStatus.textContent = `已收到鍵盤聽寫，${line.number} 號線顯示 ${measurementText(line)} mm。`; return;
    }
  }
  if (key === 'cSteel') {
    const measurement = parseSpokenMeasurement(field.value);
    if (measurement) { Object.assign(line, measurement); line.measurementExpression = measurement.measurementExpression ?? ''; }
    else { line.cSteel = field.value; line.measurementExpression = ''; }
  } else line[key] = field.value;
  updatePanel(); render(); queueSave();
}));
Object.values(fields).forEach((field) => {
  field.addEventListener('focus', () => { field.dataset.historySaved = 'false'; });
  field.addEventListener('blur', () => { field.dataset.historySaved = 'false'; if (field === fields.notes) { field.dataset.voiceMeasurement = 'false'; dictationStartNotes = null; } });
});
for (const [button, mode] of [[drawButton, 'straight'], [lDrawButton, 'chain']]) button.addEventListener('click', () => {
  state.drawMode = state.drawMode === mode ? false : mode; state.drawing = null; state.chainPoint = null; render(); updateControls();
});
undoButton.addEventListener('click', () => {
  const previous = history.pop(); if (!previous) return;
  const continuing = state.drawMode === 'chain';
  state.lines = previous.lines; state.selectedId = previous.selectedId; state.drawing = null;
  state.drawMode = continuing ? 'chain' : false; state.chainPoint = continuing ? state.lines.at(-1)?.b ?? null : null;
  updatePanel(); render(); queueSave();
});
deleteButton.addEventListener('click', () => {
  const line = selected(); if (!line) return;
  remember();
  const index = state.lines.indexOf(line);
  state.lines = state.lines.filter((item) => item.id !== line.id);
  state.selectedId = state.lines[Math.min(index, state.lines.length - 1)]?.id ?? null;
  if (state.drawMode === 'chain') state.chainPoint = state.lines.at(-1)?.b ?? null;
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
function setVoiceListening(active, message) {
  voiceButton.classList.toggle('listening', active);
  voiceButton.setAttribute('aria-pressed', String(active));
  voiceStatus.textContent = message;
}
function useKeyboardDictation(message = '未收到語音，請按鍵盤麥克風再念實際尺寸或加減算式。') {
  setVoiceListening(false, message);
  dictationStartNotes = fields.notes.value;
  fields.notes.dataset.voiceMeasurement = 'true';
  fields.notes.focus();
  fields.notes.setSelectionRange(fields.notes.value.length, fields.notes.value.length);
}
function applyVoiceText(text) {
  const line = selected(); if (!line) return;
  const spoken = String(text ?? '').trim();
  const measurement = parseSpokenMeasurement(spoken);
  setVoiceListening(Boolean(activeRecognition), `已聽到「${spoken}」。`);
  if (!spoken) { useKeyboardDictation(); return; }
  remember();
  if (measurement) {
    Object.assign(line, measurement); line.measurementExpression = measurement.measurementExpression ?? '';
    updatePanel(); render(); queueSave(); voiceStatus.textContent = `已聽到「${spoken}」，${line.number} 號線顯示 ${measurementText(line)} mm。`; return;
  }
  line.notes = [line.notes, spoken].filter(Boolean).join('\n'); updatePanel(); queueSave(); voiceStatus.textContent = `已聽到「${spoken}」，但不是有效尺寸算式；已保留為備註。`;
}
voiceButton.addEventListener('click', () => {
  if (activeRecognition) { activeRecognition.stop(); setVoiceListening(false, '已停止收音。'); return; }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!selected()) { voiceStatus.textContent = '請先選取照片上的尺寸線。'; return; }
  if (!Recognition) { useKeyboardDictation(); return; }
  const recognition = new Recognition(); recognition.lang = 'zh-TW'; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
  activeRecognition = recognition;
  let finished = false;
  let failed = false;
  setVoiceListening(true, '麥克風啟動中…');
  recognition.onstart = () => setVoiceListening(true, '麥克風已開啟，請念這條線的實際尺寸或加減算式。');
  recognition.onaudiostart = () => setVoiceListening(true, '正在收音…');
  recognition.onspeechstart = () => setVoiceListening(true, '已偵測到聲音，正在辨識…');
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const item = event.results[index];
      if (item.isFinal) { finished = true; applyVoiceText(item[0].transcript); }
      else setVoiceListening(true, `正在辨識「${item[0].transcript}」…`);
    }
  };
  recognition.onnomatch = () => setVoiceListening(true, '有收到聲音，請再念一次實際尺寸或加減式。');
  recognition.onerror = (event) => {
    failed = true; activeRecognition = null;
    useKeyboardDictation(event.error === 'not-allowed' ? '麥克風權限未開啟，請允許後再試。' : '語音辨識沒有完成，請按鍵盤麥克風再念一次。');
  };
  recognition.onend = () => {
    activeRecognition = null;
    if (failed) return;
    setVoiceListening(false, finished ? '收音已結束，尺寸已保留；按麥克風可繼續。' : '收音已結束；按麥克風可重新開始。');
  };
  try { recognition.start(); } catch { activeRecognition = null; useKeyboardDictation(); }
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
    state.drawing = null; state.chainPoint = null; state.drawMode = false; history.length = 0;
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
