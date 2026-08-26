(() => {
  const $ = id => document.getElementById(id);
  const el = {
    dropZone: $("dropZone"), fileInput: $("fileInput"),
    clipsPanel: $("clipsPanel"), clipList: $("clipList"), clipCount: $("clipCount"),
    sortNameBtn: $("sortNameBtn"), clearAllBtn: $("clearAllBtn"), refHint: $("refHint"),
    modeSelect: $("modeSelect"), offsetInput: $("offsetInput"), gapInput: $("gapInput"),
    tcFormatSel: $("tcFormatSel"), fpsSel: $("fpsSel"), fpsField: $("fpsField"),
    threshRange: $("threshRange"), threshOut: $("threshOut"),
    confRange: $("confRange"), confOut: $("confOut"), confField: $("confField"),
    trimChk: $("trimChk"), driftChk: $("driftChk"), driftField: $("driftField"),
    processBtn: $("processBtn"),
    progressWrap: document.querySelector(".progress-wrap"),
    progressBar: $("progressBar"), statusText: $("statusText"),
    resultsPanel: $("resultsPanel"), resultsBody: document.querySelector("#resultsTable tbody"),
    confHead: $("confHead"),
    langBtn: $("langBtn"),
    toast: $("toast")
  };

  const state = {
    clips: [],          // {id, name, mono, sr, duration, trimStart, trimEnd, trimThr, silent}
    refClipId: null,
    results: [],
    lastOpts: null,
    nextId: 1,
    busy: false
  };

  /* ---------------- helpers ---------------- */

  let actx = null;
  function getCtx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    return actx;
  }

  const AUDIO_RE = /\.(mp3|wav|wave|m4a|m4b|aac|ogg|oga|opus|flac|weba)$/i;
  const VIDEO_RE = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i;
  const MEDIA_RE = /\.(mp3|wav|wave|m4a|m4b|aac|ogg|oga|opus|flac|weba|mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i;

  function isVideoFile(f) {
    if (f.type) {
      if (f.type.startsWith("video/")) return true;
      if (f.type.startsWith("audio/")) return false;
    }
    return VIDEO_RE.test(f.name);
  }

  /* Fast path: browsers decode the audio track of many video containers
     (mp4/webm/mov) directly through decodeAudioData. Very large files go
     straight to realtime capture to avoid double memory usage. */
  async function extractMono(file, isVideo) {
    if (!isVideo || file.size < 400 * 1024 * 1024) {
      try {
        const buf = await getCtx().decodeAudioData(await file.arrayBuffer());
        return { mono: DSP.mixToMono(buf), sr: buf.sampleRate };
      } catch (_) { /* fall through to realtime capture */ }
    }
    return await captureFromElement(file);
  }

  /* Fallback: play the media in a hidden element and tap its audio graph.
     Works for anything the browser can play; runs at up to 4x speed. */
  async function captureFromElement(file) {
    const url = URL.createObjectURL(file);
    const media = document.createElement("video");
    media.preload = "auto";
    media.src = url;
    media.playsInline = true;
    media.style.position = "fixed";
    media.style.opacity = "0";
    media.style.pointerEvents = "none";
    document.body.appendChild(media);

    let srcNode = null, tap = null, sink = null;
    try {
      await new Promise((res, rej) => {
        media.onloadedmetadata = res;
        media.onerror = () => rej(new Error("CANNOT_PLAY"));
      });

      const ctx = getCtx();
      srcNode = ctx.createMediaElementSource(media);
      sink = ctx.createGain();
      sink.gain.value = 0;
      tap = ctx.createScriptProcessor(4096, 1, 1);

      const chunks = [];
      let total = 0;
      tap.onaudioprocess = e => {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        total += e.inputBuffer.length;
      };

      srcNode.connect(tap);
      tap.connect(sink);
      sink.connect(ctx.destination);

      for (const r of [8, 4, 2, 1]) {
        try { media.playbackRate = r; break; } catch (_) {}
      }
      await media.play();

      await new Promise(res => {
        media.onended = res;
        media.onerror = res;
        const iv = setInterval(() => { if (media.ended) { clearInterval(iv); res(); } }, 500);
        setTimeout(() => { clearInterval(iv); res(); }, (media.duration || 3600) * 1000 / Math.max(1, media.playbackRate) + 15000);
      });

      tap.onaudioprocess = null;
      const mono = new Float32Array(total);
      let off = 0;
      for (const c of chunks) { mono.set(c, off); off += c.length; }
      return { mono, sr: ctx.sampleRate };
    } finally {
      try { media.pause(); } catch (_) {}
      try { srcNode && srcNode.disconnect(); } catch (_) {}
      try { tap && tap.disconnect(); } catch (_) {}
      try { sink && sink.disconnect(); } catch (_) {}
      media.remove();
      URL.revokeObjectURL(url);
    }
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  function setBusy(b) {
    state.busy = b;
    el.processBtn.disabled = b;
  }
  function showProgress(show) { el.progressWrap.hidden = !show; }
  function setStatus(txt) { el.statusText.textContent = txt; }
  function setProgress(frac) { el.progressBar.value = Math.round(Math.max(0, Math.min(1, frac)) * 100); }

  function parseOffset(str) {
    str = (str || "").trim();
    if (!str) return 0;
    const neg = str.startsWith("-");
    str = str.replace(/^[+-]/, "").trim();
    if (!/^[\d:.]+$/.test(str)) throw new Error("bad");
    const parts = str.split(":");
    let sec = 0;
    for (const p of parts) {
      const v = parseFloat(p);
      if (isNaN(v)) throw new Error("bad");
      sec = sec * 60 + v;
    }
    return neg ? -sec : sec;
  }

  const fmtClock = s => {
    let ms = Math.round(Math.abs(s) * 1000);
    const sign = s < 0 ? "-" : "";
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const sec = Math.floor(ms / 1000); ms -= sec * 1000;
    const pad = n => String(n).padStart(2, "0");
    return sign + pad(h) + ":" + pad(m) + ":" + pad(sec) + "." + String(ms).padStart(3, "0");
  };

  /* ---------------- file intake ---------------- */

  async function addFiles(fileList) {
    if (state.busy) return;
    const files = [...fileList].filter(f => (f.type && (f.type.startsWith("audio/") || f.type.startsWith("video/"))) || MEDIA_RE.test(f.name));
    if (!files.length) return;
    setBusy(true);
    showProgress(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const vid = isVideoFile(files[i]);
        setStatus(I18N.t(vid ? "status.extract" : "status.decoding", { a: i + 1, b: files.length, name: files[i].name }));
        setProgress(i / files.length);
        await new Promise(r => setTimeout(r, 0));
        let mono, sr;
        try {
          ({ mono, sr } = await extractMono(files[i], vid));
        } catch (err) {
          console.warn(err);
          toast(I18N.t("msg.cannotPlay", { name: files[i].name }));
          continue;
        }
        let peak = 0;
        for (let j = 0; j < mono.length; j += 16) { const a = Math.abs(mono[j]); if (a > peak) peak = a; }
        if (vid && peak < 1e-4) toast(I18N.t("msg.noAudio", { name: files[i].name }));
        state.clips.push({
          id: state.nextId++,
          name: files[i].name,
          kind: vid ? "video" : "audio",
          mono,
          sr,
          duration: mono.length / sr,
          trimStart: 0, trimEnd: mono.length / sr,
          trimThr: null, silent: false
        });
      }
      setProgress(1);
      setStatus(I18N.t("status.done"));
    } catch (err) {
      console.error(err);
      toast((err && err.message) ? err.message : String(err));
    } finally {
      setTimeout(() => { showProgress(false); setProgress(0); }, 600);
      setBusy(false);
      renderClips();
    }
  }

  /* ---------------- clip list UI ---------------- */

  function renderClips() {
    const mode = el.modeSelect.value;
    const refMode = mode === "ref";
    el.clipsPanel.hidden = state.clips.length === 0;
    el.clipCount.textContent = state.clips.length;
    el.refHint.hidden = mode === "seq" || state.clips.length === 0;

    el.clipList.innerHTML = "";
    state.clips.forEach((c, i) => {
      const li = document.createElement("li");
      li.className = "clip-row" + (c.id === state.refClipId ? " is-ref" : "");
      li.draggable = true;
      li.dataset.id = c.id;

      const idx = document.createElement("span");
      idx.className = "idx"; idx.textContent = i + 1;

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = (c.kind === "video" ? "\u{1F3AC} " : "\u{1F3B5} ") + c.name;
      name.title = c.name;

      const dur = document.createElement("span");
      dur.className = "dur"; dur.textContent = fmtClock(c.duration);

      const btns = document.createElement("span");
      btns.className = "row-btns";

      const mk = (txt, title, cls, fn) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "iconbtn " + (cls || "");
        b.textContent = txt; b.title = I18N.t(title);
        b.addEventListener("click", fn);
        return b;
      };

      btns.append(
        mk("\u2605", c.id === state.refClipId ? "clips.starOff" : "clips.starOn",
          "star" + (c.id === state.refClipId ? " active" : ""), () => toggleRef(c.id)),
        mk("\u2191", "clips.up", "", () => move(i, -1)),
        mk("\u2193", "clips.down", "", () => move(i, +1)),
        mk("\u2715", "clips.remove", "danger", () => removeClip(c.id))
      );

      if (!refMode) btns.firstChild.style.display = "none";

      li.append(idx, name, dur, btns);
      attachDrag(li, c.id);
      el.clipList.appendChild(li);
    });
  }

  function toggleRef(id) {
    state.refClipId = state.refClipId === id ? null : id;
    renderClips();
  }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.clips.length) return;
    [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
    renderClips();
  }
  function removeClip(id) {
    state.clips = state.clips.filter(c => c.id !== id);
    if (state.refClipId === id) state.refClipId = null;
    renderClips();
  }

  let dragId = null;
  function attachDrag(li, id) {
    li.addEventListener("dragstart", e => {
      dragId = id;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", String(id)); } catch (_) {}
    });
    li.addEventListener("dragend", () => { dragId = null; li.classList.remove("dragging"); });
    li.addEventListener("dragover", e => { if (dragId !== null && dragId !== id) e.preventDefault(); });
    li.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation();
      if (dragId === null || dragId === id) return;
      const from = state.clips.findIndex(c => c.id === dragId);
      const moved = state.clips.splice(from, 1)[0];
      const to = state.clips.findIndex(c => c.id === id);
      const rect = li.getBoundingClientRect();
      const before = (e.clientY - rect.top) / rect.height < 0.5;
      state.clips.splice(before ? to : to + 1, 0, moved);
      dragId = null;
      renderClips();
    });
  }

  /* ---------------- processing ---------------- */

  function computeTrims(thresholdDb) {
    for (const c of state.clips) {
      if (c.trimThr === thresholdDb) continue;
      const b = DSP.detectContentBounds(c.mono, c.sr, thresholdDb);
      if (b) {
        c.trimStart = b.start / c.sr;
        c.trimEnd = b.end / c.sr;
        c.silent = false;
      } else {
        c.trimStart = 0; c.trimEnd = c.duration;
        c.silent = true;
      }
      c.trimThr = thresholdDb;
    }
  }

  function buildSequential(opts) {
    let cursor = 0;
    return state.clips.map((c, i) => {
      const cs = opts.trim ? c.trimStart : 0;
      const ce = opts.trim ? c.trimEnd : c.duration;
      const dur = Math.max(0, ce - cs);
      const row = {
        idx: i + 1, name: c.name,
        start: cursor, end: cursor + dur, dur,
        conf: null,
        note: (opts.trim && c.silent) ? I18N.t("msg.silent") : null
      };
      cursor += dur + opts.gap;
      return row;
    });
  }

  async function buildReferenceMatched(opts) {
    let ref = state.clips.find(c => c.id === state.refClipId);
    if (!ref) {
      ref = state.clips.reduce((a, b) => (b.duration > a.duration ? b : a));
      state.refClipId = ref.id;
      renderClips();
    }

    setStatus(I18N.t("status.resampling"));
    setProgress(0.02);
    const SR = 8000;
    const refX = await DSP.resample(ref.mono, ref.sr, SR);

    const others = state.clips.filter(c => c.id !== ref.id);
    const rows = [{
      idx: 1, name: "\u2605 " + ref.name,
      start: 0, end: ref.duration, dur: ref.duration,
      conf: null, driftMs: null, note: I18N.t("res.anchor")
    }];
    let cursor = ref.duration; // for unmatched fallback placement

    for (let i = 0; i < others.length; i++) {
      const c = others[i];
      setStatus(I18N.t("status.matching", { name: c.name, a: i + 1, b: others.length }));

      const fragX = await DSP.resample(c.mono, c.sr, SR);
      let row;
      if (fragX.length < refX.length && fragX.length > SR / 2) {
        const loc = await SyncEngine.locate(refX, fragX, SR, opts.confMin, p =>
          setProgress(0.05 + 0.95 * ((i + p) / others.length))
        );
        let proven = false;
        if (loc && loc.score >= opts.confMin && loc.startSamples >= -SR * 5) {
          proven = await SyncEngine.verifyPlacement(refX, fragX, loc.startSamples, loc.rate, SR, opts.confMin);
        }
        if (loc && proven && loc.score >= opts.confMin && loc.startSamples >= -SR * 5) {
          const start = Math.max(0, loc.startSamples / SR);
          const rate = loc.rate;
          row = {
            name: c.name, start,
            end: start + c.duration * rate,
            dur: c.duration, conf: loc.score,
            driftMs: Math.abs(rate - 1) > 1e-6 ? (rate - 1) * 60000 : null,
            note: loc.partial ? I18N.t("res.partial") : null
          };
        }
      }
      if (!row) {
        row = {
          name: c.name,
          start: cursor, end: cursor + c.duration, dur: c.duration,
          conf: null, driftMs: null,
          note: c.duration >= ref.duration ? I18N.t("res.longerThanRef") : I18N.t("res.unmatched")
        };
        cursor += c.duration + opts.gap;
      }
      rows.push(row);
    }

    rows.sort((a, b) => a.start - b.start);
    rows.forEach((r, i) => { r.idx = i + 1; });
    setProgress(1);
    return rows;
  }

  /* PluralEyes-style smart sync: no reference needed.
     Longest file anchors the timeline; every other file is located inside
     the anchor or inside any already-placed clip (handles spanned clips). */
  async function buildSmartSync(opts) {
    setStatus(I18N.t("status.resampling"));
    setProgress(0.02);
    const SR = 8000;
    const prepared = [];
    for (const c of state.clips) {
      prepared.push({
        id: c.id, name: c.name,
        mono: await DSP.resample(c.mono, c.sr, SR),
        sr: SR,
        duration: c.duration
      });
    }
    const n = Math.max(1, prepared.length - 1);
    const placements = await SyncEngine.align(prepared, {
      confMin: opts.confMin,
      gap: opts.gap,
      drift: opts.drift,
      onProgress: (frac, name) => {
        setStatus(I18N.t("status.matching", { name, a: Math.min(n, Math.round(frac * n) + 1), b: n }));
        setProgress(0.05 + 0.95 * frac);
      }
    });

    const rows = placements.map(p => ({
      idx: 0,
      name: (p.note === "anchor" ? "\u2605 " : "") + p.clip.name,
      start: p.start,
      end: p.end,
      dur: p.clip.duration,
      conf: p.score,
      driftMs: p.driftMs,
      note: p.note === "anchor" ? I18N.t("res.anchor") :
            p.note === "unmatched" ? I18N.t("res.unmatched") : null
    }));
    rows.sort((a, b) => a.start - b.start);
    rows.forEach((r, i) => { r.idx = i + 1; });
    setProgress(1);
    return rows;
  }

  async function processAll() {
    if (state.busy) return;
    if (!state.clips.length) { toast(I18N.t("msg.noClips")); return; }

    let offset;
    try { offset = parseOffset(el.offsetInput.value); }
    catch { toast(I18N.t("msg.badOffset")); return; }

    const opts = {
      mode: el.modeSelect.value,
      trim: el.trimChk.checked,
      thresholdDb: +el.threshRange.value,
      gap: Math.max(0, parseFloat(el.gapInput.value) || 0),
      offset,
      tcFormat: el.tcFormatSel.value,
      fps: parseFloat(el.fpsSel.value),
      confMin: +el.confRange.value / 100,
      drift: el.driftChk.checked
    };
    state.lastOpts = opts;

    setBusy(true);
    showProgress(true);
    try {
      if (opts.trim) {
        setStatus(I18N.t("status.analyzing"));
        computeTrims(opts.thresholdDb);
      }

      let rows;
      if (opts.mode === "seq") rows = buildSequential(opts);
      else if (opts.mode === "sync") rows = await buildSmartSync(opts);
      else rows = await buildReferenceMatched(opts);

      if (offset !== 0) {
        for (const r of rows) { r.start += offset; r.end += offset; }
      }

      state.results = rows;
      renderResults();
      toast(I18N.t("msg.done"));
    } catch (err) {
      console.error(err);
      toast((err && err.message) || String(err));
    } finally {
      setStatus(I18N.t("status.done"));
      setTimeout(() => { showProgress(false); setProgress(0); }, 700);
      setBusy(false);
    }
  }

  /* ---------------- results ---------------- */

  function renderResults() {
    const rows = state.results;
    const opts = state.lastOpts;
    const useFrames = opts && opts.tcFormat === "frames";
    const fmt = s => useFrames ? Exporters.fmtFramesPub(s, opts.fps) : fmtClock(s);

    const showConf = opts && opts.mode === "ref";
    const showDrift = opts && opts.mode !== "seq" && opts.drift;
    el.confHead.style.display = (showConf || showDrift) ? "" : "none";
    el.driftHead.style.display = showDrift ? "" : "none";

    el.resultsBody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      if (r.note) tr.className = "warn-row";

      const tdIdx = document.createElement("td"); tdIdx.textContent = r.idx;
      const tdName = document.createElement("td");
      tdName.textContent = r.name;
      tdName.title = r.name;
      if (r.note) {
        const small = document.createElement("div");
        small.style.cssText = "font-size:.72rem;color:var(--warn)";
        small.textContent = r.note;
        tdName.appendChild(small);
      }
      const tdS = document.createElement("td"); tdS.className = "tc"; tdS.textContent = fmt(r.start);
      const tdE = document.createElement("td"); tdE.className = "tc"; tdE.textContent = fmt(r.end);
      const tdD = document.createElement("td"); tdD.className = "tc"; tdD.textContent = fmt(r.dur);
      const tdDft = document.createElement("td"); tdDft.className = "tc";
      if (r.driftMs != null) {
        const d = r.driftMs;
        tdDft.textContent = (d >= 0 ? "+" : "") + d.toFixed(1) + " ms/min";
        if (Math.abs(d) >= 5) tdDft.style.color = "var(--warn)";
      } else if (showDrift) {
        tdDft.textContent = "\u2014";
      }
      const tdC = document.createElement("td");

      if (r.conf != null) {
        const pill = document.createElement("span");
        const pct = r.conf * 100;
        pill.className = "conf-pill " + (pct >= 70 ? "conf-high" : "conf-mid");
        pill.textContent = pct.toFixed(0) + "%";
        tdC.appendChild(pill);
      } else if (opts && opts.mode !== "seq") {
        tdC.textContent = "\u2014";
      }
      tdC.className = "tc";
      tr.append(tdIdx, tdName, tdS, tdE, tdD, tdDft, tdC);
      el.resultsBody.appendChild(tr);
    }
    el.resultsPanel.hidden = false;
    el.resultsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------------- settings wiring ---------------- */

  function syncSettingsUI() {
    const mode = el.modeSelect.value;
    const refMode = mode === "ref";
    el.confField.hidden = mode === "seq";
    el.driftField.style.display = mode === "seq" ? "none" : "";
    el.fpsField.style.display = el.tcFormatSel.value === "frames" ? "" : "none";
    el.threshOut.textContent = el.threshRange.value + " dB";
    el.confOut.textContent = el.confRange.value + "%";
    renderClips();
  }

  function bindEvents() {
    el.langBtn.addEventListener("click", () => { I18N.toggle(); renderClips(); });

    el.dropZone.addEventListener("click", () => el.fileInput.click());
    el.fileInput.addEventListener("change", e => {
      addFiles(e.target.files);
      e.target.value = "";
    });

    ["dragenter", "dragover"].forEach(ev =>
      el.dropZone.addEventListener(ev, e => { e.preventDefault(); el.dropZone.classList.add("dragover"); })
    );
    ["dragleave", "drop"].forEach(ev =>
      el.dropZone.addEventListener(ev, e => { e.preventDefault(); el.dropZone.classList.remove("dragover"); })
    );
    el.dropZone.addEventListener("drop", e => {
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    // avoid browser opening files dropped outside the zone
    ["dragover", "drop"].forEach(ev =>
      window.addEventListener(ev, e => {
        if (!(el.dropZone === e.target || el.dropZone.contains(e.target))) e.preventDefault();
      })
    );

    el.sortNameBtn.addEventListener("click", () => {
      state.clips.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      renderClips();
    });
    el.clearAllBtn.addEventListener("click", () => {
      state.clips = [];
      state.refClipId = null;
      state.results = [];
      el.resultsPanel.hidden = true;
      renderClips();
    });

    el.modeSelect.addEventListener("change", syncSettingsUI);
    el.tcFormatSel.addEventListener("change", syncSettingsUI);
    el.threshRange.addEventListener("input", syncSettingsUI);
    el.confRange.addEventListener("input", syncSettingsUI);

    el.processBtn.addEventListener("click", processAll);

    document.querySelectorAll(".exports .btn").forEach(btn =>
      btn.addEventListener("click", () => {
        if (!state.results.length) return;
        Exporters.exportAs(btn.dataset.fmt, state.results, state.lastOpts);
        if (btn.dataset.fmt === "copyjson") toast(I18N.t("msg.copied"));
      })
    );
  }

  /* ---------------- init ---------------- */

  I18N.apply();
  bindEvents();
  syncSettingsUI();
})();
