/* ============================================================
   SCRIBBLR — app.js
   All interactivity: live preview, randomness, PDF export,
   ink animation, toast notification
   ============================================================ */

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────
  const state = {
    text:          '',
    name:          '',
    date:          '',
    subject:       '',
    font:          'Caveat',
    paper:         'lined',
    inkColor:      '#1a237e',
    slant:         0,
    letterSpacing: 0,
    fontSize:      20,
    randomness:    true,
  };

  // ── Element refs ─────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  const elText       = $('input-text');
  const elName       = $('input-name');
  const elDate       = $('input-date');
  const elSubject    = $('input-subject');
  const elStylePkr   = $('style-picker');
  const elPaperTog   = $('paper-toggle');
  const elInkSwatch  = $('ink-swatches');
  const elSlant      = $('slant');
  const elSpacing    = $('letter-spacing');
  const elSize       = $('font-size');
  const elRandom     = $('randomness');
  const elDownload   = $('btn-download');
  const elPaper      = $('paper-preview');
  const elPaperText  = $('paper-text');
  const elPreviewN   = $('preview-name');
  const elPreviewD   = $('preview-date');
  const elPreviewS   = $('preview-subject');
  const elPageNum    = $('page-number');
  const elToast      = $('toast');

  const slantVal   = $('slant-val');
  const spacingVal = $('spacing-val');
  const sizeVal    = $('size-val');

  // ── Helper: show toast ────────────────────────────────────────
  function showToast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('show');
    setTimeout(() => elToast.classList.remove('show'), 3200);
  }

  // ── Helper: random offset for a character ─────────────────────
  function randOffset() {
    const dy  = (Math.random() - 0.5) * 4;   // ±2px
    const rot = (Math.random() - 0.5) * 3;   // ±1.5deg
    const sc  = 1 + (Math.random() - 0.5) * 0.06; // ±3% scale
    return `translateY(${dy.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
  }

  // ── Render preview ────────────────────────────────────────────
  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 30);
  }

  function renderPreview() {
    // Header fields
    elPreviewN.textContent = state.name;
    elPreviewD.textContent = state.date;
    elPreviewS.textContent = state.subject;

    // Paper style
    elPaper.classList.toggle('lined', state.paper === 'lined');

    // Font, color, size on the paper sheet
    elPaper.style.fontFamily  = `'${state.font}', cursive`;
    elPaper.style.color       = state.inkColor;
    elPaper.style.fontSize    = state.fontSize + 'px';
    elPaper.style.fontStyle   = state.slant !== 0 ? 'italic' : 'normal';
    elPaper.style.transform   = state.slant !== 0
      ? `skewX(${state.slant}deg)`
      : 'none';
    elPaper.style.letterSpacing = state.letterSpacing + 'px';

    // Build character spans
    const raw = state.text || '';
    const useRandom = state.randomness;

    // Split text into lines to preserve newlines
    const lines = raw.split('\n');
    let html = '';
    lines.forEach((line, li) => {
      const chars = line.length ? [...line] : [' ']; // keep blank line height
      chars.forEach(ch => {
        const isSpace = ch === ' ';
        const transform = (useRandom && !isSpace) ? `style="display:inline-block;white-space:pre;transform:${randOffset()}"` : 'style="display:inline-block;white-space:pre;"';
        html += `<span class="char" ${transform}>${escapeHtml(ch)}</span>`;
      });
      if (li < lines.length - 1) html += '<br>';
    });

    // Apply ink animation on fresh render
    elPaperText.classList.remove('ink-animate');
    // Force reflow
    void elPaperText.offsetWidth;
    elPaperText.innerHTML = html;
    elPaperText.classList.add('ink-animate');
  }

  function escapeHtml(ch) {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return ch;
  }

  // ── PDF export ────────────────────────────────────────────────
  async function exportPDF() {
    elDownload.disabled = true;
    elDownload.textContent = 'Generating...';

    try {
      const { jsPDF } = window.jspdf;

      // A4 in mm
      const pageW = 210;
      const pageH = 297;

      const preview = $('paper-preview');
      const previewRect = preview.getBoundingClientRect();
      const scale = previewRect.width > 0 ? previewRect.width / pageW : 1;

      // We'll capture the full scrollable content by temporarily expanding
      const originalOverflow = preview.style.overflow;
      const originalHeight   = preview.style.height;
      const originalAspect   = preview.style.aspectRatio;
      const originalMaxH     = preview.style.maxHeight;

      // Measure natural content height
      preview.style.overflow  = 'visible';
      preview.style.height    = 'auto';
      preview.style.aspectRatio = 'unset';
      preview.style.maxHeight = 'none';

      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const naturalH = preview.scrollHeight;
      const naturalW = preview.offsetWidth;

      const canvas = await html2canvas(preview, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#FFFDF4',
        width: naturalW,
        height: naturalH,
        windowWidth: naturalW,
        windowHeight: naturalH,
      });

      // Restore
      preview.style.overflow   = originalOverflow;
      preview.style.height     = originalHeight;
      preview.style.aspectRatio = originalAspect;
      preview.style.maxHeight  = originalMaxH;

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

      // How many mm per pixel of canvas?
      const canvasMmPerPx = pageW / (canvas.width / 2);  // canvas.width is @2x
      const totalMmHeight = (canvas.height / 2) * canvasMmPerPx;

      const totalPages = Math.ceil(totalMmHeight / pageH);
      const pxPerPage  = (pageH / canvasMmPerPx) * 2;    // @2x canvas pixels

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage();

        const srcY   = Math.round(page * pxPerPage);
        const srcH   = Math.round(Math.min(pxPerPage, canvas.height - srcY));
        const destH  = srcH * canvasMmPerPx / 2;

        // Crop the canvas slice
        const slice = document.createElement('canvas');
        slice.width  = canvas.width;
        slice.height = srcH;
        slice.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);

        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, destH);
      }

      pdf.save('handwritr-output.pdf');
      showToast('Your handwritten doc is ready ✍️');

    } catch (err) {
      console.error('PDF export failed:', err);
      showToast('Export failed. Please try again.');
    } finally {
      elDownload.disabled = false;
      elDownload.textContent = '⬇ Download PDF';
    }
  }

  // ── Event listeners ───────────────────────────────────────────

  // Text
  elText.addEventListener('input', () => { state.text = elText.value; scheduleRender(); });

  // Header fields
  elName.addEventListener('input',    () => { state.name    = elName.value;    scheduleRender(); });
  elDate.addEventListener('input',    () => { state.date    = elDate.value;    scheduleRender(); });
  elSubject.addEventListener('input', () => { state.subject = elSubject.value; scheduleRender(); });

  // Style cards
  elStylePkr.addEventListener('click', e => {
    const card = e.target.closest('.style-card');
    if (!card) return;
    document.querySelectorAll('.style-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    state.font = card.dataset.font;
    scheduleRender();
  });

  // Paper toggle
  elPaperTog.addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.paper = pill.dataset.paper;
    scheduleRender();
  });

  // Ink swatches
  elInkSwatch.addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    state.inkColor = sw.dataset.color;
    scheduleRender();
  });

  // Slant
  elSlant.addEventListener('input', () => {
    state.slant = parseFloat(elSlant.value);
    slantVal.textContent = state.slant + '°';
    scheduleRender();
  });

  // Letter spacing
  elSpacing.addEventListener('input', () => {
    state.letterSpacing = parseFloat(elSpacing.value);
    spacingVal.textContent = state.letterSpacing.toFixed(1) + 'px';
    scheduleRender();
  });

  // Font size
  elSize.addEventListener('input', () => {
    state.fontSize = parseInt(elSize.value, 10);
    sizeVal.textContent = state.fontSize + 'px';
    scheduleRender();
  });

  // Randomness
  elRandom.addEventListener('change', () => {
    state.randomness = elRandom.checked;
    scheduleRender();
  });

  // Download
  elDownload.addEventListener('click', exportPDF);

  // ── Initial render ────────────────────────────────────────────
  renderPreview();

})();
