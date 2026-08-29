const Exporters = (() => {

  function pad(n, w = 2) { return String(n).padStart(w, "0"); }

  function fmtMs(sec) {
    const sign = sec < 0 ? "-" : "";
    let ms = Math.round(Math.abs(sec) * 1000);
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const s = Math.floor(ms / 1000); ms -= s * 1000;
    return sign + pad(h) + ":" + pad(m) + ":" + pad(s) + "." + pad(ms, 3);
  }

  function fmtSrtTime(sec) {
    let ms = Math.round(Math.max(0, sec) * 1000);
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const s = Math.floor(ms / 1000); ms -= s * 1000;
    return pad(h) + ":" + pad(m) + ":" + pad(s) + "," + pad(ms, 3);
  }

  function fmtFrames(sec, fps) {
    const fpsInt = Math.round(fps);
    let total = Math.round(Math.max(0, sec) * fps);
    const f = total % fpsInt; total = Math.floor(total / fpsInt);
    const s = total % 60; total = Math.floor(total / 60);
    const m = total % 60; total = Math.floor(total / 60);
    return pad(total) + ":" + pad(m) + ":" + pad(s) + ":" + pad(f);
  }

  // rows: [{idx, name, start, end, dur, conf}]
  function makeFormatter(opts) {
    return opts.tcFormat === "frames"
      ? s => fmtFrames(s, opts.fps)
      : fmtMs;
  }

  function csv(rows, opts) {
    const f = makeFormatter(opts);
    const esc = v => '"' + String(v).replaceAll('"', '""') + '"';
    const head = ["#", "Name", "Start", "End", "Duration (s)", "Start TC", "End TC", "Confidence", "Drift (ms/min)"];
    const lines = [head.map(esc).join(",")];
    for (const r of rows) {
      lines.push([
        r.idx, esc(r.name),
        r.start.toFixed(3), r.end.toFixed(3), r.dur.toFixed(3),
        f(r.start), f(r.end),
        r.conf == null ? "" : (r.conf * 100).toFixed(1) + "%",
        r.driftMs == null ? "" : ((r.driftMs >= 0 ? "+" : "") + r.driftMs.toFixed(2))
      ].join(","));
    }
    return "\uFEFF" + lines.join("\r\n");
  }

  function json(rows, opts) {
    return JSON.stringify({
      generator: "Zamen • زامِن",
      generatedAt: new Date().toISOString(),
      mode: opts.mode,
      offsetSeconds: opts.offset,
      timecodeFormat: opts.tcFormat,
      fps: opts.fps,
      clips: rows.map(r => ({
        index: r.idx,
        name: r.name,
        startSeconds: +r.start.toFixed(4),
        endSeconds: +r.end.toFixed(4),
        durationSeconds: +r.dur.toFixed(4),
        start: makeFormatter(opts)(r.start),
        end: makeFormatter(opts)(r.end),
        confidence: r.conf == null ? null : +(r.conf).toFixed(4),
        driftMsPerMin: r.driftMs == null ? null : +(r.driftMs).toFixed(2),
        note: r.note || null
      }))
    }, null, 2);
  }

  function srt(rows) {
    return rows.map((r, i) => {
      return (i + 1) + "\r\n" +
        fmtSrtTime(r.start) + " --> " + fmtSrtTime(r.end) + "\r\n" +
        r.name + "\r\n";
    }).join("\r\n");
  }

  function labels(rows) {
    // Audacity labels: start \t end \t label
    return rows.map(r => r.start.toFixed(6) + "\t" + r.end.toFixed(6) + "\t" + r.name).join("\n");
  }

  function edl(rows, opts) {
    const f = s => fmtFrames(Math.max(0, s), opts.fps);

    /* Assign audio channels so OVERLAPPING clips land on different tracks
       (multi-camera style). Non-overlapping clips share channel A. */
    const sorted = [...rows].sort((a, b) => a.start - b.start || a.end - b.end);
    const chanOf = new Map();
    const laneEnd = [ -Infinity, -Infinity, -Infinity, -Infinity ]; // lanes A,A2,A3,A4
    for (const r of sorted) {
      let lane = laneEnd.findIndex(end => r.start >= end);
      if (lane === -1) {
        lane = laneEnd.indexOf(Math.min(...laneEnd)); // all busy: reuse emptiest
      }
      laneEnd[lane] = r.end;
      chanOf.set(r.idx, lane === 0 ? "A" : "A" + (lane + 1));
    }

    const out = ["TITLE: AUDIO TIMELINE", "FCM: NON-DROP FRAME", ""];
    rows.forEach((r, i) => {
      // reel id: editors match this (and the clip-name comment below)
      // against the media pool to relink sources automatically
      const reel = (r.name.replace(/\.[^.]+$/, "").match(/[A-Za-z0-9]+/g)?.join("") || "")
        .toUpperCase().slice(0, 8).padEnd(8, "_");
      const num = String(i + 1).padStart(3, "0");
      const chan = chanOf.get(r.idx) || "A";
      out.push(
        num + "  " + reel + " " + chan.padEnd(5) + " C        " +
        f(0) + " " + f(r.dur) + " " + f(r.start) + " " + f(r.end)
      );
      out.push("* FROM CLIP NAME: " + r.name.toUpperCase());
      if (r.conf != null) {
        out.push("* MATCH CONFIDENCE: " + (r.conf * 100).toFixed(1) + "%");
      }
      if (r.driftMs != null) {
        const pct = (1 - r.driftMs / 60000) * 100;
        out.push("* SPEED DRIFT: " + (r.driftMs >= 0 ? "+" : "") + r.driftMs.toFixed(2) +
          " ms/min  (suggested speed: " + pct.toFixed(4) + "%)");
      }
      if (r.note) out.push("* NOTE: " + r.note);
      out.push("");
    });
    return out.join("\r\n");
  }

  function txt(rows, opts) {
    const f = makeFormatter(opts);
    const nameMax = Math.min(40, Math.max(8, ...rows.map(r => r.name.length)));
    const lines = [];
    lines.push("AUDIO TIMECODE".padEnd(nameMax + 34));
    lines.push("-".repeat(nameMax + 60));
    for (const r of rows) {
      const nm = r.name.length > nameMax ? r.name.slice(0, nameMax - 1) + "\u2026" : r.name;
      const conf = r.conf == null ? "" : "  conf " + (r.conf * 100).toFixed(0) + "%";
      const drift = r.driftMs == null ? "" : "  drift " + (r.driftMs >= 0 ? "+" : "") + r.driftMs.toFixed(1) + " ms/min";
      lines.push(
        String(r.idx).padStart(3) + "  " +
        nm.padEnd(nameMax) + "  " +
        f(r.start) + "  ->  " + f(r.end) + conf + drift
      );
    }
    return lines.join("\r\n");
  }

  /* ---------- OpenTimelineIO (OTIO) — Pixar open standard ----------
     JSON-based interchange format compatible with Kdenlive 25.04+,
     Avid, Premiere (via opentimelineio), Resolve. */

  function rt(rate, seconds) {
    return {
      "OTIO_SCHEMA": "RationalTime.1",
      "rate": rate,
      "value": Math.round(Math.max(0, seconds) * rate)
    };
  }

  function otio(rows, opts) {
    const rate = opts.fps || 24;
    const seqDur = Math.max(...rows.map(r => r.end), 1);

    function makeClip(r) {
      const clipDur = Math.max(0.001, r.end - r.start);
      const filePath = r.name.replace(/^[★☆]\s*/, "").trim();
      const durVal = Math.round(clipDur * rate);

      return {
        "OTIO_SCHEMA": "Clip.2",
        "effects": [], "markers": [], "enabled": true,
        "metadata": {},
        "name": filePath,
        "source_range": {
          "OTIO_SCHEMA": "TimeRange.1",
          "start_time": { "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": 0 },
          "duration": { "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": durVal }
        },
        "media_references": {
          "DEFAULT_MEDIA": {
            "OTIO_SCHEMA": "ExternalReference.1",
            "metadata": {}, "name": "",
            "target_url": encodeURI(filePath),
            "available_range": {
              "OTIO_SCHEMA": "TimeRange.1",
              "start_time": { "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": 0 },
              "duration": { "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": durVal }
            },
            "available_image_bounds": null
          }
        },
        "active_media_reference_key": "DEFAULT_MEDIA"
      };
    }

    const tracks = rows.map((r, i) => ({
      "OTIO_SCHEMA": "Track.1",
      "metadata": {},
      "name": "A" + (i + 1),
      "source_range": {
        "OTIO_SCHEMA": "TimeRange.1",
        "start_time": { "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": Math.round(r.start * rate) },
        "duration": { "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": Math.round((r.end - r.start) * rate) }
      },
      "effects": [], "markers": [], "enabled": true,
      "children": [makeClip(r)],
      "kind": "Audio"
    }));

    return JSON.stringify({
      "OTIO_SCHEMA": "Timeline.1",
      "metadata": {},
      "name": "",
      "global_start_time": null,
      "source_range": {
        "OTIO_SCHEMA": "TimeRange.1",
        "start_time": { "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": 0 },
        "duration": { "OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": Math.round(seqDur * rate) }
      },
      "tracks": {
        "OTIO_SCHEMA": "Stack.1",
        "metadata": {},
        "name": "tracks",
        "source_range": null,
        "effects": [], "markers": [], "enabled": true,
        "children": tracks
      }
    }, null, 2);
  }

  /* ---------- FCPXML (DaVinci Resolve / Final Cut) ----------
     Unlimited lanes: every clip gets its own track above the primary
     storyline — ideal for one-master-audio + many camera angles. */

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  function rat(sec) {
    const ms = Math.max(0, Math.round(sec * 1000));
    const g = gcd(ms || 1, 1000);
    return `${ms / g}/${1000 / g}s`;
  }

  function fpsRational(fps) {
    if (Math.abs(fps - 29.97) < 0.01) return { n: 30000, d: 1001 };
    if (Math.abs(fps - 23.976) < 0.01) return { n: 24000, d: 1001 };
    return { n: Math.round(fps), d: 1 };
  }

  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fcpxml(rows, opts) {
    const fr = fpsRational(opts.fps);
    const seqDur = Math.max(...rows.map(r => r.end), 0);
    const base = n => n.replace(/\.[^.]+$/, "");

    const seen = new Set();
    let assets = "";
    rows.forEach(r => {
      const nm = base(r.name);
      if (seen.has(nm)) return;
      seen.add(nm);
      const idx = [...seen].indexOf(nm) + 1;
      assets += `      <asset id="a${idx}" name="${xmlEsc(nm)}" src="file://localhost/${encodeURI(r.name)}" format="r1" audioSources="1" audioChannels="1" />\n`;
    });

    let clips = "";
    rows.forEach((r, i) => {
      const lane = i === 0 ? "" : ` lane="${i}"`;
      const nm = base(r.name);
      const idx = [...seen].indexOf(nm) + 1;
      const noteTxt = [
        r.conf != null ? "confidence " + (r.conf * 100).toFixed(1) + "%" : null,
        r.driftMs != null ? "drift " + (r.driftMs >= 0 ? "+" : "") + r.driftMs.toFixed(2) + " ms/min" : null,
        r.note || null
      ].filter(Boolean).join(" | ");
      clips += `        <asset-clip ref="a${idx}"${lane} offset="${rat(r.start)}" duration="${rat(Math.max(0.001, r.end - r.start))}" start="${rat(0)}" name="${xmlEsc(nm)}">\n` +
               (noteTxt ? `          <note>${xmlEsc(noteTxt)}</note>\n` : "") +
               `        </asset-clip>\n`;
    });

    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<!DOCTYPE fcpxml>`,
      ``,
      `<fcpxml version="1.8">`,
      `  <resources>`,
      `    <format id="r1" frameDuration="${fr.n}/${fr.d}s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)" />`,
      assets +
      `  </resources>`,
      `  <library>`,
      `    <event name="Audio Timecode Sync">`,
      `      <project name="Synced Timeline">`,
      `        <sequence format="r1" duration="${rat(seqDur)}" tcStart="${rat(opts.offset || 0)}" tcFormat="NDF">`,
      `          <spine>`,
      clips +
      `          </spine>`,
      `        </sequence>`,
      `      </project>`,
      `    </event>`,
      `  </library>`,
      `</fcpxml>`
    ].join("\n") + "\n";
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  const registry = {
    csv:     { ext: ".csv",  mime: "text/csv",        gen: csv },
    srt:     { ext: ".srt",  mime: "text/plain",      gen: (rows) => srt(rows) },
    json:    { ext: ".json", mime: "application/json",gen: json },
    labels:  { ext: ".txt",  mime: "text/plain",      gen: (rows) => labels(rows) },
    edl:     { ext: ".edl",  mime: "text/plain",      gen: edl },
    fcpxml:  { ext: ".fcpxml", mime: "application/xml", gen: fcpxml },
    otio:    { ext: ".otio", mime: "application/json", gen: otio },
    txt:     { ext: ".txt",  mime: "text/plain",      gen: txt }
  };

  function exportAs(fmt, rows, opts) {
    if (fmt === "copyjson") {
      navigator.clipboard.writeText(json(rows, opts)).catch(() => {});
      return;
    }
    const spec = registry[fmt];
    if (!spec) return;
    download("timecode-" + stamp() + spec.ext, spec.gen(rows, opts), spec.mime);
  }

  return {
    exportAs,
    fmtFramesPub: fmtFrames,
    fmtMsPub: fmtMs,
    __internals: { csv, json, srt, labels, edl, txt, fcpxml, otio, fmtFrames, fmtMs }
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Exporters;
}
