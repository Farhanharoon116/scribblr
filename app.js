/* ============================================================
   SCRIBBLR — app.js
   All interactivity: live preview, randomness, PDF export,
   ink animation, toast notification
   ============================================================ */

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────
  const state = {
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
  const elToolbar    = $('text-toolbar');
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

  // ── Realism constants ─────────────────────────────────────────
  const MIN_DRIFT_WORDS      = 3;    // baseline drifts every 3–5 words
  const DRIFT_WORD_RANGE     = 3;
  const BASELINE_DRIFT_RANGE = 4;    // ±2 px vertical drift between word groups
  const WORD_SPACING_VARIANCE = 4;   // ±2 px extra margin between words
  const MAX_VERTICAL_OFFSET  = 3;    // hard cap on per-char vertical offset (px)
  const CHAR_JITTER_RANGE    = 2;    // ±1 px per-char vertical jitter
  const MIN_INK_OPACITY      = 0.88; // ink-fade lower bound (per word)
  const INK_OPACITY_RANGE    = 0.12; // ink-fade range: 0.88–1.0
  const TILT_FREQUENCY       = 1 / 15; // fraction of chars with extra tilt
  const OCCASIONAL_TILT_RANGE = 4;   // ±2° for the occasional tilt
  const NORMAL_WOBBLE_RANGE  = 3;    // ±1.5° for normal wobble
  const SCALE_VARIANCE       = 0.06; // ±3% scale per character
  const LETTER_SPACING_VARIANCE = 2; // ±1 px letter-spacing inconsistency

  // ── Helper: show toast ────────────────────────────────────────
  function showToast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('show');
    setTimeout(() => elToast.classList.remove('show'), 3200);
  }

  // ── Helper: escape HTML ───────────────────────────────────────
  function escapeHtml(ch) {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return ch;
  }

  // ── Parse contenteditable into [{ch, color}] array ───────────
  function getColoredChars(el) {
    const chars = [];
    let isAtBlockStart = true;

    function walk(node, color) {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const ch of node.textContent) {
          chars.push({ ch, color });
        }
        isAtBlockStart = false;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName;
      let c = color;
      // execCommand('foreColor') produces <font color="..."> in most browsers
      if (tag === 'FONT' && node.getAttribute('color')) c = node.getAttribute('color');
      // Some browsers produce <span style="color:...">
      if (node.style && node.style.color) c = node.style.color;

      if (tag === 'BR') {
        chars.push({ ch: '\n', color: c });
        isAtBlockStart = true;
        return;
      }

      // contenteditable wraps each line in a <div> or <p> after Enter
      const isBlock = tag === 'DIV' || tag === 'P';
      if (isBlock && node !== el) {
        if (!isAtBlockStart) chars.push({ ch: '\n', color });
        isAtBlockStart = true;
      }

      for (const child of node.childNodes) {
        walk(child, c);
      }
    }

    walk(el, null);

    // Trim trailing newlines
    while (chars.length > 0 && chars[chars.length - 1].ch === '\n') {
      chars.pop();
    }
    return chars;
  }

  // ── Build preview HTML with all realism effects ───────────────
  function buildHtml(coloredChars) {
    if (!coloredChars.length) return '';

    const useRandom = state.randomness;

    // Tokenize into word / space / newline tokens
    const tokens = [];
    let i = 0;
    while (i < coloredChars.length) {
      const { ch, color } = coloredChars[i];
      if (ch === '\n') {
        tokens.push({ type: 'newline' });
        i++;
      } else if (ch === ' ') {
        tokens.push({ type: 'space', color });
        i++;
      } else {
        const wordChars = [];
        while (i < coloredChars.length && coloredChars[i].ch !== ' ' && coloredChars[i].ch !== '\n') {
          wordChars.push(coloredChars[i]);
          i++;
        }
        tokens.push({ type: 'word', chars: wordChars });
      }
    }

    let html = '';
    // Baseline-drift state — resets per line
    let wordCount    = 0;
    let nextDriftAtWordCount = MIN_DRIFT_WORDS + Math.floor(Math.random() * DRIFT_WORD_RANGE);
    let baselineDrift = 0; // px
    let isLineStart  = true;

    tokens.forEach(token => {
      if (token.type === 'newline') {
        html += '<br>';
        isLineStart   = true;
        baselineDrift = 0; // pen repositions to new line
        wordCount     = 0;
        nextDriftAtWordCount = MIN_DRIFT_WORDS + Math.floor(Math.random() * DRIFT_WORD_RANGE);
        return;
      }

      if (token.type === 'space') {
        // Word-spacing variation
        const extraWordSpacing = useRandom ? ((Math.random() - 0.5) * WORD_SPACING_VARIANCE).toFixed(1) : '0';
        html += `<span class="char" style="display:inline-block;white-space:pre;margin-right:${extraWordSpacing}px"> </span>`;

        // Each space = word boundary; drift may shift every 3–5 words
        wordCount++;
        if (useRandom && wordCount >= nextDriftAtWordCount) {
          baselineDrift        = (Math.random() - 0.5) * BASELINE_DRIFT_RANGE;
          wordCount            = 0;
          nextDriftAtWordCount = MIN_DRIFT_WORDS + Math.floor(Math.random() * DRIFT_WORD_RANGE);
        }
        return;
      }

      // ── Word token ───────────────────────────────────────────
      // Pen-pressure simulation: font-weight 400 or 500, per word
      const wordWeight = useRandom ? (Math.random() < 0.5 ? 400 : 500) : 400;
      // Ink-fade: opacity MIN_INK_OPACITY–1.0, per word
      const wordOpacity = useRandom ? (MIN_INK_OPACITY + Math.random() * INK_OPACITY_RANGE).toFixed(3) : '1';

      token.chars.forEach(({ ch, color }, idx) => {
        // First char of each line gets 1–2 px size boost (human instinct)
        const isFirst   = isLineStart && idx === 0;
        const sizeBoost = (isFirst && useRandom) ? 1 + Math.floor(Math.random() * 2) : 0;

        // Vertical: drift + per-char jitter, capped at MAX_VERTICAL_OFFSET
        let dy = 0;
        if (useRandom) {
          dy = Math.max(-MAX_VERTICAL_OFFSET, Math.min(MAX_VERTICAL_OFFSET,
            baselineDrift + (Math.random() - 0.5) * CHAR_JITTER_RANGE));
        }

        // Rotation: occasional tilt (TILT_FREQUENCY) ±2°, rest ±1.5°
        let rot = 0;
        if (useRandom) {
          rot = Math.random() < TILT_FREQUENCY
            ? (Math.random() - 0.5) * OCCASIONAL_TILT_RANGE
            : (Math.random() - 0.5) * NORMAL_WOBBLE_RANGE;
        }

        const sc = useRandom ? (1 + (Math.random() - 0.5) * SCALE_VARIANCE).toFixed(3) : '1';

        // Letter-spacing inconsistency: ±1 px per character
        const charMargin = useRandom ? ((Math.random() - 0.5) * LETTER_SPACING_VARIANCE).toFixed(1) : '0';

        const transform = `translateY(${dy.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${sc})`;

        const styleParts = ['display:inline-block', 'white-space:pre'];
        if (useRandom) {
          styleParts.push(`transform:${transform}`);
          styleParts.push(`font-weight:${wordWeight}`);
          styleParts.push(`opacity:${wordOpacity}`);
          styleParts.push(`margin-right:${charMargin}px`);
          if (sizeBoost > 0) styleParts.push(`font-size:${state.fontSize + sizeBoost}px`);
        }
        if (color) styleParts.push(`color:${color}`);

        html += `<span class="char" style="${styleParts.join(';')}">${escapeHtml(ch)}</span>`;
      });

      isLineStart = false;
    });

    return html;
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
    elPaper.style.fontFamily    = `'${state.font}', cursive`;
    elPaper.style.color         = state.inkColor;
    elPaper.style.fontSize      = state.fontSize + 'px';
    elPaper.style.fontStyle     = state.slant !== 0 ? 'italic' : 'normal';
    elPaper.style.transform     = state.slant !== 0 ? `skewX(${state.slant}deg)` : 'none';
    elPaper.style.letterSpacing = state.letterSpacing + 'px';

    // Build character spans from contenteditable content
    const coloredChars = getColoredChars(elText);
    const html = buildHtml(coloredChars);

    // Apply ink animation on fresh render
    elPaperText.classList.remove('ink-animate');
    void elPaperText.offsetWidth;
    elPaperText.innerHTML = html;
    elPaperText.classList.add('ink-animate');
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

      pdf.save('scribblr-output.pdf');
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

  // Text (contenteditable)
  elText.addEventListener('input', () => {
    // Normalize empty state so CSS :empty placeholder shows
    if (!elText.textContent.trim()) elText.innerHTML = '';
    scheduleRender();
  });

  // Paste: strip rich formatting, insert plain text only
  elText.addEventListener('paste', e => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    scheduleRender();
  });

  // Rich text color toolbar
  elToolbar.addEventListener('mousedown', e => {
    // Prevent swatch click from stealing focus (and text selection) from the editor
    if (e.target.closest('.text-swatch')) e.preventDefault();
  });

  elToolbar.addEventListener('click', e => {
    const sw = e.target.closest('.text-swatch');
    if (!sw) return;
    document.querySelectorAll('.text-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    // Apply color to the current selection inside the contenteditable editor
    document.execCommand('foreColor', false, sw.dataset.color);
    elText.focus();
    scheduleRender();
  });

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
