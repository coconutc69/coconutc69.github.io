(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileListEl = document.getElementById('fileList');
  const compressBtn = document.getElementById('compressBtn');
  const progressFill = document.getElementById('progressFill');
  const statusText = document.getElementById('statusText');
  const gaugeNeedle = document.getElementById('gaugeNeedle');
  const gaugeText = document.getElementById('gaugeText');

  /** @type {File[]} */
  let files = [];

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function fileKey(f) {
    return `${f.name}::${f.size}::${f.lastModified}`;
  }

  function addFiles(newFiles) {
    const existingKeys = new Set(files.map(fileKey));
    for (const f of newFiles) {
      if (!existingKeys.has(fileKey(f))) {
        files.push(f);
        existingKeys.add(fileKey(f));
      }
    }
    renderList();
  }

  function removeFile(index) {
    files.splice(index, 1);
    renderList();
  }

  function renderList() {
    fileListEl.innerHTML = '';

    if (files.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-row';
      li.textContent = '— no files loaded —';
      fileListEl.appendChild(li);
      compressBtn.disabled = true;
      setStatus('AWAITING INPUT');
      resetGauge();
      return;
    }

    files.forEach((f, idx) => {
      const li = document.createElement('li');

      const ln = document.createElement('span');
      ln.className = 'ln';
      ln.textContent = String(idx + 1).padStart(2, '0');

      const name = document.createElement('span');
      name.className = 'fname';
      name.title = f.name;
      name.textContent = f.name;

      const size = document.createElement('span');
      size.className = 'fsize';
      size.textContent = formatBytes(f.size);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.setAttribute('aria-label', `Remove ${f.name}`);
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => removeFile(idx));

      li.append(ln, name, size, removeBtn);
      fileListEl.appendChild(li);
    });

    compressBtn.disabled = false;
    setStatus(`${files.length} FILE${files.length > 1 ? 'S' : ''} LOADED`);
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  function setProgress(pct) {
    progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function resetGauge() {
    gaugeNeedle.style.transform = 'rotate(-90deg)';
    gaugeText.textContent = 'SPACE SAVED: —';
  }

  function setGauge(percentSaved) {
    // Needle sweeps from -90deg (0%) to +90deg (100%)
    const clamped = Math.max(0, Math.min(100, percentSaved));
    const angle = -90 + (clamped / 100) * 180;
    gaugeNeedle.style.transform = `rotate(${angle}deg)`;
    gaugeText.textContent = `SPACE SAVED: ${clamped.toFixed(1)}%`;
  }

  // --- Drag & drop / click-to-browse wiring ---

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length) addFiles(dropped);
  });

  // --- Compression ---

  compressBtn.addEventListener('click', async () => {
    if (files.length === 0) return;

    compressBtn.disabled = true;
    setProgress(0);
    setStatus('READING FILES...');

    try {
      const zip = new JSZip();
      const totalOriginalSize = files.reduce((sum, f) => sum + f.size, 0);

      for (const f of files) {
        const buffer = await f.arrayBuffer();
        zip.file(f.name, buffer);
      }

      setStatus('COMPRESSING...');

      const blob = await zip.generateAsync(
        {
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 9 }, // maximum compression
        },
        (metadata) => {
          setProgress(metadata.percent);
          setStatus(`COMPRESSING... ${metadata.percent.toFixed(0)}%`);
        }
      );

      setProgress(100);
      setStatus('DOWNLOAD READY');

      const percentSaved = totalOriginalSize > 0
        ? (1 - blob.size / totalOriginalSize) * 100
        : 0;
      setGauge(percentSaved);

      triggerDownload(blob, 'archive.zip');
    } catch (err) {
      console.error(err);
      setStatus('ERROR — SEE CONSOLE');
    } finally {
      compressBtn.disabled = false;
    }
  });

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  renderList();
})();
