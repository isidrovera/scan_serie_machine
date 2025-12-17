window.addEventListener('load', () => {
  console.log('✅ Scanner cargado correctamente');

  // ------------------ utilidades generales ------------------
  const tbody = document.getElementById('tbody');
  const cntTotal = document.getElementById('cntTotal');
  const cntUnique = document.getElementById('cntUnique');
  const cntDup = document.getElementById('cntDup');

  const list = [];
  const seen = new Map();
  const DEDUP_MS = 1500;

  const fmtTime = d => d.toLocaleTimeString();
  const escapeHtml = s =>
    String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));

  function resetResultsTable(){
    list.length = 0;
    seen.clear();
    tbody.innerHTML = '';
    cntTotal.textContent = '0';
    cntUnique.textContent = '0';
    cntDup.textContent = '0';
  }

  function addRow(value, type, source){
    const t = new Date();
    list.unshift({ts:t, value, type, source});
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="small">${fmtTime(t)}</td>` +
      `<td class="mono">${escapeHtml(value)}</td>` +
      `<td class="small">${escapeHtml(type||'-')}</td>` +
      `<td class="small">${escapeHtml(source||'-')}</td>`;
    tbody.prepend(tr);

    cntTotal.textContent = (+cntTotal.textContent + 1);
    if(!seen.has(value)){
      cntUnique.textContent = (+cntUnique.textContent + 1);
    }else{
      cntDup.textContent = (+cntDup.textContent + 1);
    }
    seen.set(value, Date.now());
  }

  document.getElementById('btn-copy').addEventListener('click', async ()=>{
    const lines = list.map(r => r.value);
    await navigator.clipboard.writeText(lines.join('\n'));
  });

  document.getElementById('btn-csv').addEventListener('click', ()=>{
    const rows = [['timestamp','valor','tipo','fuente'],
      ...list.map(r => [r.ts.toISOString(), r.value, r.type||'', r.source||''])
    ];
    const csv = rows
      .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lecturas_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
    a.click();
  });

  document.getElementById('btn-clear').addEventListener('click', resetResultsTable);

  // ------------------ tabs ------------------
  const tabCodes = document.getElementById('tab-codes');
  const tabOcr = document.getElementById('tab-ocr');
  const paneCodes = document.getElementById('pane-codes');
  const paneOcr = document.getElementById('pane-ocr');
  const panelTitle = document.getElementById('panel-title');
  const controlsCodes = document.getElementById('controls-codes');
  const controlsOcr = document.getElementById('controls-ocr');

  function activateTab(which){
    const isCodes = which === 'codes';
    tabCodes.classList.toggle('active', isCodes);
    tabOcr.classList.toggle('active', !isCodes);
    tabCodes.setAttribute('aria-selected', isCodes ? 'true' : 'false');
    tabOcr.setAttribute('aria-selected', !isCodes ? 'true' : 'false');
    paneCodes.style.display = isCodes ? '' : 'none';
    paneOcr.style.display = !isCodes ? '' : 'none';
    controlsCodes.style.display = isCodes ? '' : 'none';
    controlsOcr.style.display = !isCodes ? '' : 'none';
    panelTitle.innerHTML = isCodes
      ? '<i class="bi bi-upc-scan"></i> Lector de Códigos'
      : '<i class="bi bi-file-earmark-text"></i> OCR con selección';

    if(isCodes){
      stopOcrCamera();
      showOcrPhoto(false);
    }else{
      stopCodes();
      startOcrCamera();
    }
  }

  tabCodes.addEventListener('click', () => activateTab('codes'));
  tabOcr.addEventListener('click', () => activateTab('ocr'));

  // ------------------ Panel Odoo ------------------
  const odooStatus = document.getElementById('odoo-status');
  const odooPanel = document.getElementById('odoo-panel');
  const odooSerie = document.getElementById('odoo-serie');
  const odooMarca = document.getElementById('odoo-marca');
  const odooModelo = document.getElementById('odoo-modelo');
  const btnConfirmOk = document.getElementById('btn-confirm-ok');
  const btnConfirmObs = document.getElementById('btn-confirm-obs');

  let lastScan = null;

  function setOdooStatus(msg, ok=false, err=false){
    odooStatus.className = 'status' + (ok ? ' ok' : err ? ' err' : '');
    odooStatus.innerHTML =
      (ok ? '<i class="bi bi-check-circle"></i> '
           : err ? '<i class="bi bi-x-circle"></i> '
                  : '<i class="bi bi-info-circle"></i> ') + msg;
  }

  function clearOdooPanel(){
    odooPanel.style.display = 'none';
    odooSerie.textContent = '-';
    odooMarca.textContent = '-';
    odooModelo.textContent = '-';
    lastScan = null;
  }

  // ============ MODALES ============
  const modalObs = document.getElementById('modal-obs');
  const modalObsClose = document.getElementById('modal-obs-close');
  const modalObsCancel = document.getElementById('modal-obs-cancel');
  const modalObsConfirm = document.getElementById('modal-obs-confirm');
  const modalObsSerie = document.getElementById('modal-obs-serie');
  const modalObsInput = document.getElementById('modal-obs-input');

  const modalPick = document.getElementById('modal-pick');
  const modalPickClose = document.getElementById('modal-pick-close');
  const modalPickCancel = document.getElementById('modal-pick-cancel');
  const modalPickSub = document.getElementById('modal-pick-sub');
  const modalPickList = document.getElementById('modal-pick-list');

  // ✅ Modal Pendientes
  const btnPendientes = document.getElementById('btn-pendientes');
  const pendientesCountEl = document.getElementById('pendientes-count');

  const modalPending = document.getElementById('modal-pending');
  const modalPendingClose = document.getElementById('modal-pending-close');
  const modalPendingCancel = document.getElementById('modal-pending-cancel');
  const modalPendingCount = document.getElementById('modal-pending-count');
  const modalPendingSub = document.getElementById('modal-pending-sub');
  const modalPendingList = document.getElementById('modal-pending-list');

  function showModal(el){
    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function hideModal(el){
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function closeAllModals(){
    hideModal(modalObs);
    hideModal(modalPick);
    if(modalPending) hideModal(modalPending);
  }

  [modalObs, modalPick, modalPending].filter(Boolean).forEach(m => {
    m.addEventListener('click', (ev) => {
      if(ev.target === m) hideModal(m);
    });
  });

  modalObsClose.addEventListener('click', () => hideModal(modalObs));
  modalObsCancel.addEventListener('click', () => hideModal(modalObs));

  modalPickClose.addEventListener('click', () => hideModal(modalPick));
  modalPickCancel.addEventListener('click', () => hideModal(modalPick));

  if(modalPendingClose) modalPendingClose.addEventListener('click', () => hideModal(modalPending));
  if(modalPendingCancel) modalPendingCancel.addEventListener('click', () => hideModal(modalPending));

  window.addEventListener('keydown', (ev) => {
    if(ev.key === 'Escape') closeAllModals();
  });

  // ----------- Campo Observación (modal) -----------
  let obsInput = { value: '' };

  // ----------- UI Manual (inyectado) -----------
  const manualMount = document.getElementById('manual-mount');

  const manualWrap = document.createElement('div');
  manualWrap.className = 'panel';
  manualWrap.innerHTML = `
    <div class="field-label">
      <i class="bi bi-search"></i> Búsqueda manual
    </div>

    <div class="row">
      <input id="manual-input" class="input input-fixed" type="text"
             inputmode="numeric" pattern="[0-9]*" maxlength="4"
             placeholder="Serie completa o últimos 4 dígitos"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             style="flex:1; min-width:220px;">
      <button class="btn" id="btn-manual-search"><i class="bi bi-search"></i> Buscar</button>
      <button class="btn" id="btn-manual-clear"><i class="bi bi-x-lg"></i> Limpiar</button>
    </div>

    <div id="manual-hint" class="small">
      Tip: escribe 1 a 4 dígitos numéricos para buscar coincidencias y elegir en lista.
    </div>
  `;
  manualMount.appendChild(manualWrap);

  const manualInput = manualWrap.querySelector('#manual-input');
  const btnManualSearch = manualWrap.querySelector('#btn-manual-search');
  const btnManualClear = manualWrap.querySelector('#btn-manual-clear');

  manualInput.addEventListener('focus', () => {
    setTimeout(() => manualInput.scrollIntoView({ block:'nearest' }), 50);
  });

  manualInput.addEventListener('input', () => {
    manualInput.value = (manualInput.value || '').replace(/\D+/g,'');
  });

  function debounce(fn, ms){
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function inferSearchMode(vtrim){
    return /^\d{1,4}$/.test(vtrim) ? 'partial' : 'exact';
  }

  function renderPartialResults(records, sourceForSelect='manual'){
    clearOdooPanel();

    modalPickList.innerHTML = '';
    modalPickSub.innerHTML = `Se encontraron <b>${records.length}</b> equipos. Elige uno:`;

    records.slice(0, 50).forEach((r) => {
      const serie = r.serie || '-';
      const modelo = r.modelo || '-';
      const marca = r.marca || '-';
      const ubic = r.ubicacion || '-';
      const disp = r.disponibilidad || '-';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pick-btn';

      btn.innerHTML = `
        <div class="pick-top">
          <div>
            <div class="mono" style="font-weight:900;">${escapeHtml(serie)}</div>
            <div class="pick-meta">${escapeHtml(marca)} · ${escapeHtml(modelo)}</div>
            <div class="pick-meta">Ubic: ${escapeHtml(ubic)} · Disp: ${escapeHtml(disp)}</div>
          </div>
          <div class="small" style="white-space:nowrap;">
            <i class="bi bi-check2-square"></i> Seleccionar
          </div>
        </div>
      `;

      btn.addEventListener('click', () => {
        hideModal(modalPick);

        manualInput.value = '';
        if(obsInput) obsInput.value = '';

        odooSerie.textContent = serie;
        odooMarca.textContent = marca;
        odooModelo.textContent = modelo;
        odooPanel.style.display = '';

        lastScan = {
          value: serie,
          source: sourceForSelect || 'manual',
          type: 'MANUAL_SELECT',
          record: r,
        };

        setOdooStatus('Equipo seleccionado. Ya puedes confirmar.', true, false);
        addRow(serie, 'MANUAL_SELECT', 'manual');
      });

      modalPickList.appendChild(btn);
    });

    showModal(modalPick);
  }

  // ------------------ API (via Flask /api/scan) ------------------
  let lastLookupToken = 0;

  async function lookupSerial(value, source, typeLabel, searchMode=null){
    if(!value){ return; }

    const vtrim = String(value).trim().toUpperCase();
    if(!vtrim){
      clearOdooPanel();
      setOdooStatus('Escanea un código o usa OCR para consultar en Odoo.');
      return;
    }

    const finalMode = searchMode || inferSearchMode(vtrim);
    setOdooStatus('Consultando en servidor…');
    odooPanel.style.display = 'none';

    const token = ++lastLookupToken;

    try{
      const resp = await fetch('/api/scan', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          value: vtrim,
          source: source || 'manual',
          mode: 'lookup',
          search_mode: finalMode,
        }),
      });

      const data = await resp.json();
      if(token !== lastLookupToken) return;

      if(!data.ok || !data.odoo){
        clearOdooPanel();
        setOdooStatus(data.message || 'No se pudo validar en el servidor.', false, true);
        return;
      }

      const o = data.odoo;
      if(!o.ok){
        clearOdooPanel();
        setOdooStatus(o.message || 'No se pudo validar en Odoo.', false, true);
        return;
      }

      if(o.code === 'lookup_partial_ok' && Array.isArray(o.records)){
        if(!o.records.length){
          clearOdooPanel();
          setOdooStatus('No se encontraron equipos con esos dígitos (sin revisar).', false, true);
          return;
        }
        setOdooStatus('Selecciona un equipo de la lista (búsqueda parcial).', true, false);
        renderPartialResults(o.records, source);
        return;
      }

      const rec = o.record || {};
      if(!rec || !rec.serie){
        clearOdooPanel();
        setOdooStatus('Serie no encontrada (sin revisar).', false, true);
        return;
      }

      odooSerie.textContent = rec.serie || vtrim;
      odooMarca.textContent = rec.marca || '-';
      odooModelo.textContent = rec.modelo || '-';
      odooPanel.style.display = '';

      lastScan = {
        value: rec.serie || vtrim,
        source: source || 'manual',
        type: typeLabel,
        record: rec,
      };

      if(obsInput) obsInput.value = '';
      setOdooStatus('Serie encontrada (sin revisar). Confirma para registrar ingreso.', true, false);
    }catch(e){
      clearOdooPanel();
      setOdooStatus('Error al contactar servidor: ' + (e && e.message ? e.message : e), false, true);
    }
  }

  function resetForNextEntry(){
    lastLookupToken++;
    closeAllModals();

    clearOdooPanel();
    manualInput.value = '';
    if(obsInput) obsInput.value = '';

    resetResultsTable();
    setOdooStatus('Listo. Escanea otro código o usa OCR / búsqueda manual.');

    if(tabOcr.classList.contains('active')){
      btnRetake.click();
    }
  }

  async function confirmSerialAuto(){
    if(!lastScan){
      setOdooStatus('No hay lectura para confirmar.', false, true);
      return;
    }

    const observation = (obsInput ? (obsInput.value || '').trim() : '');
    const status = observation ? 'obs' : 'ok';

    setOdooStatus('Registrando check de ingreso…');

    try{
      const resp = await fetch('/api/scan', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          value: lastScan.value,
          source: lastScan.source || 'manual',
          mode: 'confirm',
          status,
          observation,
        }),
      });

      const data = await resp.json();

      if(!data.ok || !data.odoo){
        setOdooStatus(data.message || 'No se pudo registrar en el servidor.', false, true);
        return;
      }

      const o = data.odoo;
      if(!o.ok){
        setOdooStatus(o.message || 'No se pudo registrar en Odoo.', false, true);
        return;
      }

      setOdooStatus(o.message || 'Check de ingreso registrado correctamente.', true, false);
      resetForNextEntry();

    }catch(e){
      setOdooStatus('Error al contactar servidor: ' + (e && e.message ? e.message : e), false, true);
    }
  }

  btnConfirmObs.style.display = 'none';
  btnConfirmOk.addEventListener('click', () => {
    if(!lastScan){
      setOdooStatus('No hay lectura para confirmar.', false, true);
      return;
    }
    modalObsSerie.textContent = lastScan.value || '-';
    modalObsInput.value = (obsInput && obsInput.value) ? obsInput.value : '';
    showModal(modalObs);
    setTimeout(() => modalObsInput.focus(), 50);
  });

  modalObsConfirm.addEventListener('click', async () => {
    if(obsInput) obsInput.value = (modalObsInput.value || '').trim();
    hideModal(modalObs);
    await confirmSerialAuto();
  });

  // ----------- Manual: búsqueda automática al escribir -----------
  const liveLookup = debounce(() => {
    const v = (manualInput.value || '').trim().toUpperCase();

    if(!v){
      clearOdooPanel();
      setOdooStatus('Escanea un código o usa OCR para consultar en Odoo.');
      return;
    }

    lookupSerial(v, 'manual', 'MANUAL', null);
  }, 220);

  manualInput.addEventListener('input', () => {
    lastScan = null;
    odooPanel.style.display = 'none';
    liveLookup();
  });

  btnManualSearch.addEventListener('click', () => {
    const v = (manualInput.value || '').trim().toUpperCase();
    if(!v){
      setOdooStatus('Escribe una serie o 1-4 dígitos para buscar.', false, true);
      return;
    }
    lookupSerial(v, 'manual', 'MANUAL', null);
  });

  btnManualClear.addEventListener('click', () => {
    manualInput.value = '';
    clearOdooPanel();
    if(obsInput) obsInput.value = '';
    setOdooStatus('Escanea un código o usa OCR para consultar en Odoo.');
  });

  manualInput.addEventListener('keydown', (ev) => {
    if(ev.key === 'Enter'){
      ev.preventDefault();
      const v = (manualInput.value || '').trim().toUpperCase();
      if(v) lookupSerial(v, 'manual', 'MANUAL', null);
    }
  });

  // ------------------ PENDIENTES (contador + listar) ------------------
  const CHECKIN_URL = window.SCANNER_CHECKIN_PATH || '/sat/api/checkin';
  console.log('[PEND] CHECKIN_URL=', CHECKIN_URL);

  async function fetchPendientesCount(){
    if(!pendientesCountEl) return;
    try{
      console.log('[PEND][COUNT] POST', CHECKIN_URL);
      const resp = await fetch(CHECKIN_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'count' })
      });
      const txt = await resp.text();
      console.log('[PEND][COUNT] status=', resp.status, 'body=', txt);

      const data = JSON.parse(txt);
      if(data && data.ok){
        const n = Number(data.pendientes_count || 0);
        pendientesCountEl.textContent = String(n);
        if(modalPendingCount) modalPendingCount.textContent = String(n);
      }
    }catch(e){
      console.error('[PEND][COUNT][ERR]', e);
    }
  }

  function renderPendingItems(items){
    if(!modalPendingList) return;
    modalPendingList.innerHTML = '';

    if(!items || !items.length){
      modalPendingList.innerHTML = `<div class="small">No hay pendientes.</div>`;
      return;
    }

    items.forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pick-btn';
      btn.innerHTML = `
        <div class="pick-top">
          <div>
            <div style="font-weight:900;">${escapeHtml(it.modelo || '-')}</div>
            <div class="pick-meta mono">${escapeHtml(it.serie || '-')}</div>
          </div>
          <div class="small" style="white-space:nowrap;">
            <i class="bi bi-arrow-right-circle"></i> Usar
          </div>
        </div>
      `;

      btn.addEventListener('click', () => {
        hideModal(modalPending);

        const serie = (it.serie || '').trim();
        if(!serie) return;

        manualInput.value = serie;
        lookupSerial(serie, 'manual', 'MANUAL', 'exact');
      });

      modalPendingList.appendChild(btn);
    });
  }

  async function openPendientesList(){
    if(!modalPending) return;

    if(modalPendingSub) modalPendingSub.textContent = 'Cargando lista…';
    if(modalPendingList) modalPendingList.innerHTML = '';
    showModal(modalPending);

    try{
      console.log('[PEND][LIST] POST', CHECKIN_URL);
      const resp = await fetch(CHECKIN_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'list_pending', limit: 200, offset: 0 })
      });
      const txt = await resp.text();
      console.log('[PEND][LIST] status=', resp.status, 'body=', txt);

      const data = JSON.parse(txt);

      if(!data || !data.ok){
        if(modalPendingSub) modalPendingSub.textContent = 'No se pudo cargar.';
        return;
      }

      const n = Number(data.pendientes_count || 0);
      if(pendientesCountEl) pendientesCountEl.textContent = String(n);
      if(modalPendingCount) modalPendingCount.textContent = String(n);

      if(modalPendingSub){
        modalPendingSub.innerHTML = `Mostrando <b>${data.count || 0}</b> (máx ${data.limit || 200}).`;
      }

      renderPendingItems(data.items || []);
    }catch(e){
      console.error('[PEND][LIST][ERR]', e);
      if(modalPendingSub) modalPendingSub.textContent = 'Error cargando lista.';
    }
  }

  if(btnPendientes){
    btnPendientes.addEventListener('click', openPendientesList);
  }

  fetchPendientesCount();
  setInterval(fetchPendientesCount, 20000);

  // ------------------ CÓDIGOS (html5-qrcode) ------------------
  const statusCodes = document.getElementById('status-codes');
  const btnStartCodes = document.getElementById('btn-start-codes');
  const btnStopCodes = document.getElementById('btn-stop-codes');
  let html5qr = null;
  let codesRunning = false;

  function setStatusCodes(msg, ok=false, err=false){
    statusCodes.className = 'status' + (ok ? ' ok' : err ? ' err' : '');
    statusCodes.innerHTML =
      (ok ? '<i class="bi bi-check-circle"></i> '
           : err ? '<i class="bi bi-x-circle"></i> '
                  : '<i class="bi bi-info-circle"></i> ') + msg;
  }

  async function startCodes(){
    if(codesRunning) return;
    if(!window.Html5Qrcode){
      setStatusCodes('Librería html5-qrcode no cargó', false, true);
      return;
    }
    try{
      html5qr = html5qr || new Html5Qrcode("qr-reader", { verbose:false });
      const cfg = {
        fps: 12,
        rememberLastUsedCamera: true,
        qrbox: (vw, vh) => {
          const s = Math.floor(Math.min(vw, vh) * 0.7);
          return { width: s, height: s };
        },
        aspectRatio: 3/4,
      };

      await html5qr.start(
        { facingMode: { exact: "environment" } },
        cfg,
        (txt) => {
          const now = Date.now();
          const last = seen.get(txt) || 0;
          if(now - last < DEDUP_MS){
            seen.set(txt, now);
            return;
          }
          seen.set(txt, now);

          manualInput.value = '';
          if(obsInput) obsInput.value = '';

          addRow(txt, 'AUTO', 'códigos');
          setStatusCodes('Leído: <b>'+escapeHtml(txt)+'</b>', true, false);
          lookupSerial(txt, 'qr', 'AUTO', 'exact');
        },
        () => {}
      );

      codesRunning = true;
      btnStartCodes.disabled = true;
      btnStopCodes.disabled = false;
      setStatusCodes('Escaneando… cámara posterior.');
    }catch(e){
      try{
        await html5qr.start(
          { facingMode: "environment" },
          { fps:12, rememberLastUsedCamera:true, aspectRatio:3/4 },
          (txt) => {
            const now = Date.now();
            const last = seen.get(txt) || 0;
            if(now - last < DEDUP_MS){
              seen.set(txt, now);
              return;
            }
            seen.set(txt, now);

            manualInput.value = '';
            if(obsInput) obsInput.value = '';

            addRow(txt, 'AUTO', 'códigos');
            setStatusCodes('Leído: <b>'+escapeHtml(txt)+'</b>', true, false);
            lookupSerial(txt, 'qr', 'AUTO', 'exact');
          },
          () => {}
        );
        codesRunning = true;
        btnStartCodes.disabled = true;
        btnStopCodes.disabled = false;
        setStatusCodes('Escaneando… (fallback) cámara posterior.');
      }catch(e2){
        setStatusCodes('No se pudo iniciar la cámara: '+e2, false, true);
      }
    }
  }

  async function stopCodes(){
    if(html5qr && codesRunning){
      try{ await html5qr.stop(); }catch(_){}
      try{ await html5qr.clear(); }catch(_){}
    }
    codesRunning = false;
    btnStartCodes.disabled = false;
    btnStopCodes.disabled = true;
  }

  btnStartCodes.addEventListener('click', startCodes);
  btnStopCodes.addEventListener('click', stopCodes);

  // ------------------ OCR ------------------
  const ocrVideo = document.getElementById('ocr-video');
  const ocrVideoShell = document.getElementById('ocr-video-shell');
  const ocrCanvas = document.getElementById('ocr-canvas');
  const ocrCanvasShell = document.getElementById('ocr-canvas-shell');
  const textLayer = document.getElementById('text-layer');
  const btnTake = document.getElementById('btn-take');
  const btnRetake = document.getElementById('btn-retake');
  const btnUseSelected = document.getElementById('btn-use-selected');
  const statusOcr = document.getElementById('status-ocr');
  const selectedTextInfo = document.getElementById('selected-text-info');
  const selectedTextValue = document.getElementById('selected-text-value');

  let ocrStream = null;
  let currentSelectedText = '';

  function setStatusOcr(msg, ok=false, err=false){
    statusOcr.className = 'status' + (ok ? ' ok' : err ? ' err' : '');
    statusOcr.innerHTML =
      (ok ? '<i class="bi bi-check-circle"></i> '
           : err ? '<i class="bi bi-x-circle"></i> '
                  : '<i class="bi bi-info-circle"></i> ') + msg;
  }

  async function startOcrCamera(){
    showOcrPhoto(false);
    try{
      ocrStream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:{ exact:"environment" } },
        audio:false,
      });
    }catch(_){
      ocrStream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:"environment" },
        audio:false,
      });
    }
    ocrVideo.srcObject = ocrStream;
    await ocrVideo.play().catch(()=>{});
    setStatusOcr('Cámara activa. Apunta y pulsa "Tomar foto".');
    btnTake.disabled = false;
    btnRetake.disabled = true;
    btnUseSelected.disabled = true;
    selectedTextInfo.style.display = 'none';
    currentSelectedText = '';
    textLayer.style.display = 'none';
    textLayer.innerHTML = '';
  }

  function stopOcrCamera(){
    if(ocrStream){
      ocrStream.getTracks().forEach(t=>t.stop());
      ocrStream=null;
    }
    ocrVideo.pause();
    ocrVideo.srcObject=null;
  }

  function showOcrPhoto(show){
    ocrVideoShell.style.display = show ? 'none' : '';
    ocrCanvasShell.style.display = show ? '' : 'none';
  }

  btnTake.addEventListener('click', async ()=>{
    if(!ocrVideo.videoWidth){
      setStatusOcr('Esperando video…', false, true);
      return;
    }

    const w = ocrVideo.videoWidth;
    const h = ocrVideo.videoHeight;

    ocrCanvas.width = w;
    ocrCanvas.height = h;
    const ctx = ocrCanvas.getContext('2d', { willReadFrequently:true });
    ctx.drawImage(ocrVideo, 0, 0, w, h);

    showOcrPhoto(true);
    btnTake.disabled = true;
    btnRetake.disabled = false;
    btnUseSelected.disabled = true;
    selectedTextInfo.style.display = 'none';
    currentSelectedText = '';
    textLayer.style.display = 'none';
    textLayer.innerHTML = '';

    setStatusOcr('Enviando imagen al servidor para OCR…');

    try{
      const dataUrl = ocrCanvas.toDataURL('image/jpeg', 0.9);

      const resp = await fetch('/api/ocr', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ image: dataUrl })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        setStatusOcr(`Error del servidor (${resp.status}): ${errorText.substring(0, 120)}`, false, true);
        return;
      }

      const data = await resp.json();
      if(!data.ok){
        setStatusOcr(data.message || 'Error OCR.', false, true);
        return;
      }

      const best = (data.best || '').trim();
      if(best){
        const cleaned = best.replace(/\s+/g,'').trim();
        if(cleaned){
          manualInput.value = '';
          if(obsInput) obsInput.value = '';

          addRow(cleaned, 'OCR_AUTO', 'ocr');
          setStatusOcr('Serie OCR: <b>'+escapeHtml(cleaned)+'</b>', true);
          lookupSerial(cleaned, 'ocr', 'OCR_AUTO', 'exact');
          return;
        }
      }

      setStatusOcr('No se detectó serie automática. (Selección manual pendiente)', true);
    }catch(e){
      setStatusOcr('Error OCR: ' + (e && e.message ? e.message : e), false, true);
    }
  });

  btnRetake.addEventListener('click', ()=>{
    showOcrPhoto(false);
    btnTake.disabled = false;
    btnRetake.disabled = true;
    btnUseSelected.disabled = true;
    selectedTextInfo.style.display = 'none';
    currentSelectedText = '';
    textLayer.style.display = 'none';
    textLayer.innerHTML = '';
    setStatusOcr('Cámara activa. Apunta y pulsa "Tomar foto".');
  });

  // --------- estado inicial ---------
  setOdooStatus('Escanea un código o usa OCR para consultar en Odoo.');
  activateTab('codes');
});
