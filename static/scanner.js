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
    if (tbody) tbody.innerHTML = '';
    if (cntTotal) cntTotal.textContent = '0';
    if (cntUnique) cntUnique.textContent = '0';
    if (cntDup) cntDup.textContent = '0';
  }

  function addRow(value, type, source){
    if(!tbody || !cntTotal || !cntUnique || !cntDup) return;

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

  const btnCopy = document.getElementById('btn-copy');
  btnCopy && btnCopy.addEventListener('click', async ()=>{
    const lines = list.map(r => r.value);
    await navigator.clipboard.writeText(lines.join('\n'));
    console.log('[UI] Copiado al portapapeles', lines.length);
  });

  const btnCsv = document.getElementById('btn-csv');
  btnCsv && btnCsv.addEventListener('click', ()=>{
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
    console.log('[UI] CSV generado');
  });

  const btnClear = document.getElementById('btn-clear');
  btnClear && btnClear.addEventListener('click', () => {
    console.log('[UI] Limpiar');
    resetResultsTable();
  });

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
    tabCodes && tabCodes.classList.toggle('active', isCodes);
    tabOcr && tabOcr.classList.toggle('active', !isCodes);
    tabCodes && tabCodes.setAttribute('aria-selected', isCodes ? 'true' : 'false');
    tabOcr && tabOcr.setAttribute('aria-selected', !isCodes ? 'true' : 'false');
    if (paneCodes) paneCodes.style.display = isCodes ? '' : 'none';
    if (paneOcr) paneOcr.style.display = !isCodes ? '' : 'none';
    if (controlsCodes) controlsCodes.style.display = isCodes ? '' : 'none';
    if (controlsOcr) controlsOcr.style.display = !isCodes ? '' : 'none';
    if (panelTitle){
      panelTitle.innerHTML = isCodes
        ? '<i class="bi bi-upc-scan"></i> Lector de Códigos'
        : '<i class="bi bi-file-earmark-text"></i> OCR con selección';
    }

    console.log('[TAB]', which);

    if(isCodes){
      stopOcrCamera();
      showOcrPhoto(false);
    }else{
      stopCodes();
      startOcrCamera();
    }
  }

  tabCodes && tabCodes.addEventListener('click', () => activateTab('codes'));
  tabOcr && tabOcr.addEventListener('click', () => activateTab('ocr'));

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
    if(!odooStatus) return;
    odooStatus.className = 'status' + (ok ? ' ok' : err ? ' err' : '');
    odooStatus.innerHTML =
      (ok ? '<i class="bi bi-check-circle"></i> '
           : err ? '<i class="bi bi-x-circle"></i> '
                  : '<i class="bi bi-info-circle"></i> ') + msg;
  }

  function clearOdooPanel(){
    if (odooPanel) odooPanel.style.display = 'none';
    if (odooSerie) odooSerie.textContent = '-';
    if (odooMarca) odooMarca.textContent = '-';
    if (odooModelo) odooModelo.textContent = '-';
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

  // ✅ Pendientes (badge + modal)
  const btnPendientes = document.getElementById('btn-pendientes');
  const pendientesCountEl = document.getElementById('pendientes-count');

  const modalPending = document.getElementById('modal-pending');
  const modalPendingClose = document.getElementById('modal-pending-close');
  const modalPendingCancel = document.getElementById('modal-pending-cancel');
  const modalPendingCount = document.getElementById('modal-pending-count');
  const modalPendingSub = document.getElementById('modal-pending-sub');
  const modalPendingList = document.getElementById('modal-pending-list');

  function showModal(el){
    if(!el) return;
    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function hideModal(el){
    if(!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function closeAllModals(){
    hideModal(modalObs);
    hideModal(modalPick);
    hideModal(modalPending);
  }

  [modalObs, modalPick, modalPending].filter(Boolean).forEach(m => {
    m.addEventListener('click', (ev) => {
      if(ev.target === m) hideModal(m);
    });
  });

  modalObsClose && modalObsClose.addEventListener('click', () => hideModal(modalObs));
  modalObsCancel && modalObsCancel.addEventListener('click', () => hideModal(modalObs));

  modalPickClose && modalPickClose.addEventListener('click', () => hideModal(modalPick));
  modalPickCancel && modalPickCancel.addEventListener('click', () => hideModal(modalPick));

  modalPendingClose && modalPendingClose.addEventListener('click', () => hideModal(modalPending));
  modalPendingCancel && modalPendingCancel.addEventListener('click', () => hideModal(modalPending));

  window.addEventListener('keydown', (ev) => {
    if(ev.key === 'Escape') closeAllModals();
  });

  // ----------- Campo Observación (antes inyectado, ahora modal) -----------
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
  manualMount && manualMount.appendChild(manualWrap);

  const manualInput = manualWrap.querySelector('#manual-input');
  const btnManualSearch = manualWrap.querySelector('#btn-manual-search');
  const btnManualClear = manualWrap.querySelector('#btn-manual-clear');

  manualInput && manualInput.addEventListener('focus', () => {
    setTimeout(() => manualInput.scrollIntoView({ block:'nearest' }), 50);
  });

  manualInput && manualInput.addEventListener('input', () => {
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

    if(!modalPickList || !modalPickSub) return;

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

        if (manualInput) manualInput.value = '';
        if(obsInput) obsInput.value = '';

        if (odooSerie) odooSerie.textContent = serie;
        if (odooMarca) odooMarca.textContent = marca;
        if (odooModelo) odooModelo.textContent = modelo;
        if (odooPanel) odooPanel.style.display = '';

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
    if (odooPanel) odooPanel.style.display = 'none';

    const token = ++lastLookupToken;

    try{
      console.log('[LOOKUP] -> /api/scan', {value:vtrim, source, finalMode});

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
        console.warn('[LOOKUP] servidor no-ok', data);
        return;
      }

      const o = data.odoo;
      if(!o.ok){
        clearOdooPanel();
        setOdooStatus(o.message || 'No se pudo validar en Odoo.', false, true);
        console.warn('[LOOKUP] odoo no-ok', o);
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

      if (odooSerie) odooSerie.textContent = rec.serie || vtrim;
      if (odooMarca) odooMarca.textContent = rec.marca || '-';
      if (odooModelo) odooModelo.textContent = rec.modelo || '-';
      if (odooPanel) odooPanel.style.display = '';

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
      console.error('[LOOKUP] ERROR', e);
    }
  }

  function resetForNextEntry(){
    lastLookupToken++;
    closeAllModals();

    clearOdooPanel();
    if (manualInput) manualInput.value = '';
    if(obsInput) obsInput.value = '';

    resetResultsTable();
    setOdooStatus('Listo. Escanea otro código o usa OCR / búsqueda manual.');

    if(tabOcr && tabOcr.classList.contains('active')){
      btnRetake && btnRetake.click();
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
      console.log('[CONFIRM] -> /api/scan', {value:lastScan.value, source:lastScan.source, status, observation});

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
        console.warn('[CONFIRM] servidor no-ok', data);
        return;
      }

      const o = data.odoo;
      if(!o.ok){
        setOdooStatus(o.message || 'No se pudo registrar en Odoo.', false, true);
        console.warn('[CONFIRM] odoo no-ok', o);
        return;
      }

      setOdooStatus(o.message || 'Check de ingreso registrado correctamente.', true, false);
      resetForNextEntry();

    }catch(e){
      setOdooStatus('Error al contactar servidor: ' + (e && e.message ? e.message : e), false, true);
      console.error('[CONFIRM] ERROR', e);
    }
  }

  // ✅ Botón Confirmar: abre modal
  if (btnConfirmObs) btnConfirmObs.style.display = 'none';
  btnConfirmOk && btnConfirmOk.addEventListener('click', () => {
    if(!lastScan){
      setOdooStatus('No hay lectura para confirmar.', false, true);
      return;
    }
    if (modalObsSerie) modalObsSerie.textContent = lastScan.value || '-';
    if (modalObsInput) modalObsInput.value = (obsInput && obsInput.value) ? obsInput.value : '';
    showModal(modalObs);
    setTimeout(() => modalObsInput && modalObsInput.focus(), 50);
  });

  modalObsConfirm && modalObsConfirm.addEventListener('click', async () => {
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

  manualInput && manualInput.addEventListener('input', () => {
    lastScan = null;
    if (odooPanel) odooPanel.style.display = 'none';
    liveLookup();
  });

  btnManualSearch && btnManualSearch.addEventListener('click', () => {
    const v = (manualInput.value || '').trim().toUpperCase();
    if(!v){
      setOdooStatus('Escribe una serie o 1-4 dígitos para buscar.', false, true);
      return;
    }
    lookupSerial(v, 'manual', 'MANUAL', null);
  });

  btnManualClear && btnManualClear.addEventListener('click', () => {
    if (manualInput) manualInput.value = '';
    clearOdooPanel();
    if(obsInput) obsInput.value = '';
    setOdooStatus('Escanea un código o usa OCR para consultar en Odoo.');
  });

  manualInput && manualInput.addEventListener('keydown', (ev) => {
    if(ev.key === 'Enter'){
      ev.preventDefault();
      const v = (manualInput.value || '').trim().toUpperCase();
      if(v) lookupSerial(v, 'manual', 'MANUAL', null);
    }
  });

  // ------------------ ✅ PENDIENTES (contador + listar) ------------------
  // ✅ IMPORTANTE: NO llamar a Odoo directo por CORS.
  // Llamamos a Flask (mismo origen) y Flask proxea a Odoo.
  const CHECKIN_URL = '/api/pending';

  function logPend(...args){ console.log('[PEND]', ...args); }
  function warnPend(...args){ console.warn('[PEND]', ...args); }
  function errPend(...args){ console.error('[PEND]', ...args); }

  logPend('Pendientes endpoint (proxy) =', CHECKIN_URL);

  async function safeJson(resp){
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if(ct.includes('application/json')) return await resp.json();
    const txt = await resp.text();
    throw new Error(`Respuesta no-JSON (${resp.status}) ct=${ct} body=${txt.slice(0,200)}`);
  }

  function setPendCount(n){
    const val = String(Number(n || 0));
    if (pendientesCountEl) pendientesCountEl.textContent = val;
    if (modalPendingCount) modalPendingCount.textContent = val;
  }

  async function fetchPendientesCount(){
    if(!pendientesCountEl) return;

    try{
      logPend('POST count ->', CHECKIN_URL);

      const resp = await fetch(CHECKIN_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'count' })
      });

      logPend('count status =', resp.status);

      if(!resp.ok){
        const t = await resp.text();
        warnPend('count HTTP no-ok', resp.status, t.slice(0,200));
        return;
      }

      const data = await safeJson(resp);
      logPend('count data =', data);

      if(data && data.ok){
        setPendCount(data.pendientes_count || 0);
      }else{
        warnPend('count respuesta no-ok', data);
      }
    }catch(e){
      errPend('count ERROR', e);
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

        if (manualInput) manualInput.value = serie;
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
      logPend('POST list_pending ->', CHECKIN_URL);

      const resp = await fetch(CHECKIN_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'list_pending', limit: 200, offset: 0 })
      });

      logPend('list_pending status =', resp.status);

      if(!resp.ok){
        const t = await resp.text();
        errPend('list_pending HTTP no-ok', resp.status, t.slice(0,200));
        if(modalPendingSub) modalPendingSub.textContent = `Error HTTP ${resp.status}`;
        return;
      }

      const data = await safeJson(resp);
      logPend('list_pending data =', data);

      if(!data || !data.ok){
        if(modalPendingSub) modalPendingSub.textContent = (data && data.message) ? data.message : 'No se pudo cargar.';
        return;
      }

      setPendCount(data.pendientes_count || 0);

      if(modalPendingSub){
        modalPendingSub.innerHTML = `Mostrando <b>${data.count || 0}</b> (máx ${data.limit || 200}).`;
      }

      renderPendingItems(data.items || []);
    }catch(e){
      errPend('list_pending ERROR', e);
      if(modalPendingSub) modalPendingSub.textContent = 'Error cargando lista.';
    }
  }

  btnPendientes && btnPendientes.addEventListener('click', openPendientesList);

  fetchPendientesCount();
  setInterval(fetchPendientesCount, 20000);

  // ------------------ CÓDIGOS (html5-qrcode) ------------------
  const statusCodes = document.getElementById('status-codes');
  const btnStartCodes = document.getElementById('btn-start-codes');
  const btnStopCodes = document.getElementById('btn-stop-codes');
  let html5qr = null;
  let codesRunning = false;

  function setStatusCodes(msg, ok=false, err=false){
    if(!statusCodes) return;
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

          if (manualInput) manualInput.value = '';
          if(obsInput) obsInput.value = '';

          addRow(txt, 'AUTO', 'códigos');
          setStatusCodes('Leído: <b>'+escapeHtml(txt)+'</b>', true, false);
          lookupSerial(txt, 'qr', 'AUTO', 'exact');
        },
        () => {}
      );

      codesRunning = true;
      if (btnStartCodes) btnStartCodes.disabled = true;
      if (btnStopCodes) btnStopCodes.disabled = false;
      setStatusCodes('Escaneando… cámara posterior.');
      console.log('[QR] Iniciado');
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

            if (manualInput) manualInput.value = '';
            if(obsInput) obsInput.value = '';

            addRow(txt, 'AUTO', 'códigos');
            setStatusCodes('Leído: <b>'+escapeHtml(txt)+'</b>', true, false);
            lookupSerial(txt, 'qr', 'AUTO', 'exact');
          },
          () => {}
        );
        codesRunning = true;
        if (btnStartCodes) btnStartCodes.disabled = true;
        if (btnStopCodes) btnStopCodes.disabled = false;
        setStatusCodes('Escaneando… (fallback) cámara posterior.');
        console.log('[QR] Iniciado (fallback)');
      }catch(e2){
        setStatusCodes('No se pudo iniciar la cámara: '+e2, false, true);
        console.error('[QR] ERROR start', e2);
      }
    }
  }

  async function stopCodes(){
    if(html5qr && codesRunning){
      try{ await html5qr.stop(); }catch(_){}
      try{ await html5qr.clear(); }catch(_){}
    }
    codesRunning = false;
    if (btnStartCodes) btnStartCodes.disabled = false;
    if (btnStopCodes) btnStopCodes.disabled = true;
    console.log('[QR] Stop');
  }

  btnStartCodes && btnStartCodes.addEventListener('click', startCodes);
  btnStopCodes && btnStopCodes.addEventListener('click', stopCodes);

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
    if(!statusOcr) return;
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
    if (ocrVideo) ocrVideo.srcObject = ocrStream;
    await (ocrVideo ? ocrVideo.play().catch(()=>{}) : Promise.resolve());
    setStatusOcr('Cámara activa. Apunta y pulsa "Tomar foto".');
    if (btnTake) btnTake.disabled = false;
    if (btnRetake) btnRetake.disabled = true;
    if (btnUseSelected) btnUseSelected.disabled = true;
    if (selectedTextInfo) selectedTextInfo.style.display = 'none';
    currentSelectedText = '';
    if (textLayer){
      textLayer.style.display = 'none';
      textLayer.innerHTML = '';
    }
    console.log('[OCR] cámara activa');
  }

  function stopOcrCamera(){
    if(ocrStream){
      ocrStream.getTracks().forEach(t=>t.stop());
      ocrStream=null;
    }
    if (ocrVideo){
      ocrVideo.pause();
      ocrVideo.srcObject=null;
    }
    console.log('[OCR] stop');
  }

  function showOcrPhoto(show){
    if (ocrVideoShell) ocrVideoShell.style.display = show ? 'none' : '';
    if (ocrCanvasShell) ocrCanvasShell.style.display = show ? '' : 'none';
  }

  btnTake && btnTake.addEventListener('click', async ()=>{
    if(!ocrVideo || !ocrVideo.videoWidth){
      setStatusOcr('Esperando video…', false, true);
      return;
    }

    const w = ocrVideo.videoWidth;
    const h = ocrVideo.videoHeight;

    if (!ocrCanvas) return;
    ocrCanvas.width = w;
    ocrCanvas.height = h;
    const ctx = ocrCanvas.getContext('2d', { willReadFrequently:true });
    ctx.drawImage(ocrVideo, 0, 0, w, h);

    showOcrPhoto(true);
    if (btnTake) btnTake.disabled = true;
    if (btnRetake) btnRetake.disabled = false;
    if (btnUseSelected) btnUseSelected.disabled = true;
    if (selectedTextInfo) selectedTextInfo.style.display = 'none';
    currentSelectedText = '';
    if (textLayer){
      textLayer.style.display = 'none';
      textLayer.innerHTML = '';
    }

    setStatusOcr('Enviando imagen al servidor para OCR…');

    try{
      const dataUrl = ocrCanvas.toDataURL('image/jpeg', 0.9);

      console.log('[OCR] -> /api/ocr');

      const resp = await fetch('/api/ocr', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ image: dataUrl })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        setStatusOcr(`Error del servidor (${resp.status}): ${errorText.substring(0, 120)}`, false, true);
        console.error('[OCR] servidor status', resp.status, errorText);
        return;
      }

      const data = await resp.json();
      if(!data.ok){
        setStatusOcr(data.message || 'Error OCR.', false, true);
        console.warn('[OCR] no-ok', data);
        return;
      }

      const best = (data.best || '').trim();
      if(best){
        const cleaned = best.replace(/\s+/g,'').trim();
        if(cleaned){
          if (manualInput) manualInput.value = '';
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
      console.error('[OCR] ERROR', e);
    }
  });

  btnRetake && btnRetake.addEventListener('click', ()=>{
    showOcrPhoto(false);
    if (btnTake) btnTake.disabled = false;
    if (btnRetake) btnRetake.disabled = true;
    if (btnUseSelected) btnUseSelected.disabled = true;
    if (selectedTextInfo) selectedTextInfo.style.display = 'none';
    currentSelectedText = '';
    if (textLayer){
      textLayer.style.display = 'none';
      textLayer.innerHTML = '';
    }
    setStatusOcr('Cámara activa. Apunta y pulsa "Tomar foto".');
  });

  // --------- estado inicial ---------
  setOdooStatus('Escanea un código o usa OCR para consultar en Odoo.');
  activateTab('codes');
});
