/**
 * WebP Converter — Theme App Extension JavaScript
 * Works with webp-converter.liquid block
 * Calls the app's /api/convert endpoint via App Proxy
 */

(function () {
  'use strict';

  // ── Config ─────────────────────────────────────────────────────────────
  // The App Proxy URL — Shopify forwards /apps/webp-converter/* to your app
  const CONVERT_URL = '/apps/webp-converter/api/convert';

  // ── State ──────────────────────────────────────────────────────────────
  let files = [];

  // ── DOM Refs ───────────────────────────────────────────────────────────
  const dropzone    = document.getElementById('wc-dropzone');
  const fileInput   = document.getElementById('wc-file-input');
  const browseBtn   = document.getElementById('wc-browse-btn');
  const convertBtn  = document.getElementById('wc-convert-btn');
  const clearBtn    = document.getElementById('wc-clear-btn');
  const dlAllBtn    = document.getElementById('wc-dl-all-btn');
  const toolbar     = document.getElementById('wc-toolbar');
  const fileList    = document.getElementById('wc-file-list');
  const emptyState  = document.getElementById('wc-empty');
  const statsEl     = document.getElementById('wc-stats');
  const statCount   = document.getElementById('wc-stat-count');
  const statOrig    = document.getElementById('wc-stat-orig');
  const statSaved   = document.getElementById('wc-stat-saved');
  const countTotal  = document.getElementById('wc-count-total');
  const countDone   = document.getElementById('wc-count-done');

  if (!dropzone) return; // Guard: block not on page

  // ── Drag & Drop ────────────────────────────────────────────────────────
  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzone.classList.add('is-dragging');
  });

  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('is-dragging');
  });

  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('is-dragging');
    addFiles(Array.from(e.dataTransfer.files));
  });

  dropzone.addEventListener('click', function (e) {
    if (e.target === browseBtn) return;
    fileInput.click();
  });

  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  browseBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    addFiles(Array.from(fileInput.files));
    fileInput.value = ''; // reset so same file can be re-added
  });

  // ── Button Actions ─────────────────────────────────────────────────────
  convertBtn.addEventListener('click', convertAll);

  clearBtn.addEventListener('click', function () {
    files = [];
    render();
  });

  dlAllBtn.addEventListener('click', downloadAll);

  // ── Add Files ──────────────────────────────────────────────────────────
  function addFiles(rawFiles) {
    var newFiles = rawFiles
      .filter(function (f) { return /\.(jpe?g|png)$/i.test(f.name); })
      .map(function (f) {
        return {
          id: Math.random().toString(36).slice(2),
          file: f,
          origURL: URL.createObjectURL(f),
          origKB: (f.size / 1024).toFixed(1),
          status: 'pending',
          convURL: null,
          convBlob: null,
          convKB: null,
          error: null
        };
      });

    if (!newFiles.length) {
      alert('Please select JPG or PNG images only.');
      return;
    }

    files = files.concat(newFiles);
    render();
  }

  // ── Convert All ────────────────────────────────────────────────────────
  function convertAll() {
    var pending = files.filter(function (f) {
      return f.status === 'pending' || f.status === 'error';
    });
    if (!pending.length) return;

    convertBtn.disabled = true;

    var promises = pending.map(function (f) { return convertOne(f.id); });

    Promise.all(promises).then(function () {
      convertBtn.disabled = false;
      render();
    });
  }

  function convertOne(id) {
    updateFile(id, { status: 'converting' });
    render();

    var f = files.find(function (f) { return f.id === id; });
    var fd = new FormData();
    fd.append('file', f.file);

    return fetch(CONVERT_URL, { method: 'POST', body: fd })
      .then(function (res) {
        if (!res.ok) throw new Error('Server error ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var convURL = URL.createObjectURL(blob);
        var convKB  = (blob.size / 1024).toFixed(1);
        updateFile(id, { status: 'done', convURL: convURL, convBlob: blob, convKB: convKB, error: null });
        render();
      })
      .catch(function (err) {
        updateFile(id, { status: 'error', error: err.message });
        render();
      });
  }

  function updateFile(id, patch) {
    files = files.map(function (f) {
      return f.id === id ? Object.assign({}, f, patch) : f;
    });
  }

  // ── Download ───────────────────────────────────────────────────────────
  function downloadOne(f) {
    var a = document.createElement('a');
    a.href = f.convURL;
    a.download = f.file.name.replace(/\.[^.]+$/, '') + '.webp';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function downloadAll() {
    files.filter(function (f) { return f.status === 'done'; }).forEach(downloadOne);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render() {
    var total   = files.length;
    var done    = files.filter(function (f) { return f.status === 'done'; });
    var allDone = total > 0 && files.every(function (f) {
      return f.status === 'done';
    });
    var converting = files.some(function (f) { return f.status === 'converting'; });

    // Toolbar
    toolbar.hidden = total === 0;
    countTotal.textContent = total;
    countDone.textContent  = done.length;
    convertBtn.disabled = converting || (total > 0 && allDone);
    dlAllBtn.hidden = !(allDone && done.length > 1);

    // Stats
    statsEl.hidden = done.length === 0;
    if (done.length > 0) {
      var origTotal = done.reduce(function (s, f) { return s + parseFloat(f.origKB); }, 0);
      var convTotal = done.reduce(function (s, f) { return s + parseFloat(f.convKB); }, 0);
      var pct = origTotal > 0 ? Math.round((1 - convTotal / origTotal) * 100) : 0;
      statCount.textContent = done.length;
      statOrig.textContent  = origTotal.toFixed(0) + ' KB';
      statSaved.textContent = pct + '% saved';
    }

    // Empty state
    emptyState.hidden = total > 0;

    // Remove rows that no longer exist
    Array.from(fileList.querySelectorAll('.wc-file-row')).forEach(function (row) {
      if (!files.find(function (f) { return f.id === row.dataset.id; })) {
        row.remove();
      }
    });

    // Add / update rows
    files.forEach(function (f) {
      var row = fileList.querySelector('.wc-file-row[data-id="' + f.id + '"]');
      if (!row) {
        row = document.createElement('div');
        row.className = 'wc-file-row';
        row.dataset.id = f.id;
        fileList.appendChild(row);
      }

      // Update class
      row.className = 'wc-file-row wc-file-row--' + f.status;

      // Rebuild inner HTML
      row.innerHTML = buildRowHTML(f);

      // Attach events
      var dlBtn = row.querySelector('.js-dl');
      if (dlBtn) dlBtn.addEventListener('click', function () { downloadOne(f); });

      var retryBtn = row.querySelector('.js-retry');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          updateFile(f.id, { status: 'pending', error: null });
          render();
        });
      }
    });
  }

  function buildRowHTML(f) {
    var thumb = '<img class="wc-thumb" src="' + f.origURL + '" alt="preview" loading="lazy">';

    var badge = {
      pending:    '<span class="wc-badge wc-badge--pending">Pending</span>',
      converting: '<span class="wc-badge wc-badge--converting"><span class="wc-spinner"></span>&nbsp;Converting…</span>',
      done:       '<span class="wc-badge wc-badge--done">✓ WebP</span>',
      error:      '<span class="wc-badge wc-badge--error" title="' + esc(f.error || '') + '">✗ Failed</span>'
    }[f.status] || '';

    var pct     = f.convKB ? Math.round((1 - parseFloat(f.convKB) / parseFloat(f.origKB)) * 100) : 0;
    var progress = f.status === 'converting'
      ? '<div class="wc-progress"><div class="wc-progress__bar"></div></div>'
      : '';

    var extras = '';
    if (f.status === 'done') {
      extras =
        '<span class="wc-arrow">→</span>' +
        '<div class="wc-savings">' + f.convKB + ' KB<small>' + pct + '% smaller</small></div>' +
        badge +
        '<button class="wc-btn wc-btn--ghost js-dl" type="button">⬇ Download</button>';
    } else if (f.status === 'error') {
      extras = badge + '<button class="wc-btn wc-btn--ghost js-retry" type="button" style="font-size:12px">↩ Retry</button>';
    } else {
      extras = badge;
    }

    return (
      thumb +
      '<div class="wc-file-info">' +
        '<div class="wc-file-name">' + esc(f.file.name) + '</div>' +
        '<div class="wc-file-meta">' + f.origKB + ' KB &nbsp;·&nbsp; ' + esc(f.file.type || 'image') + progress + '</div>' +
      '</div>' +
      extras
    );
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial render
  render();

})();
