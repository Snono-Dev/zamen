const I18N = (() => {
  const dict = {
    ar: {
      "app.title": "Zamen • زامِن",
      "app.subtitle": "مزامن المقاطع الصوتية والفيديو تلقائياً على الخط الزمني — يعمل بالكامل في متصفحك بدون أي API",
      "app.tagline": "كل مقطع يجد لحظته",
      "drop.title": "اسحب ملفات الصوت أو الفيديو هنا أو انقر للاختيار",
      "drop.hint": "MP3 · WAV · M4A · OGG · FLAC · MP4 · WEBM · MOV",
      "clips.title": "الملفات المختارة",
      "clips.sortByName": "ترتيب حسب الاسم",
      "clips.clearAll": "مسح الكل",
      "clips.up": "تحريك لأعلى",
      "clips.down": "تحريك لأسفل",
      "clips.remove": "إزالة",
      "clips.starOn": "تعيين كمرجع",
      "clips.starOff": "إلغاء المرجع",
      "set.title": "الإعدادات",
      "set.mode": "الوضع",
      "set.modeSync": "مزامنة ذكية للكل (بدون مرجع)",
      "set.modeSeq": "تسلسل تراكمي (ملف بعد ملف)",
      "set.modeRef": "مطابقة تلقائية مع مرجع",
      "set.refHint": "في وضع المطابقة: علام النجمة ★ على التسجيل المرجعي (يُختار الأطول تلقائياً)، وسيتم البحث عن موقع بقية المقاطع داخله بالمطابقة الصوتية مع عرض نسبة الثقة. في وضع المزامنة الذكية لا تحتاج مرجعاً — تُحاذى الملفات بعضها ببعض تلقائياً.",
      "set.trim": "قص صمت البداية والنهاية",
      "set.drift": "قياس وتصحيح انجراف السرعة (Drift)",
      "set.thresh": "عتبة الصمت",
      "set.gap": "فاصل بين المقاطع (ثانية)",
      "set.offset": "إزاحة زمنية Offset",
      "set.offsetHint": "تُضاف لكل التوقيتات — مثل: 90 أو 1:30 أو 1:02:03 (يقبل سالباً)",
      "set.tcFormat": "صيغة التوقيت",
      "set.tcMs": "HH:MM:SS.mmm",
      "set.tcFrames": "HH:MM:SS:FF (فريمات)",
      "set.fps": "الإطارات/ثانية",
      "set.conf": "حد الثقة المقبول",
      "btn.process": "إنشاء التايم كود",
      "status.decoding": "جارِ فك ترميز {a}/{b} …",
      "status.extract": "جارِ استخراج الصوت من الفيديو «{name}» ({a}/{b}) …",
      "status.analyzing": "جارِ تحليل الصمت…",
      "status.matching": "مطابقة «{name}» ({a}/{b}) …",
      "status.resampling": "جارِ تجهيز المطابقة…",
      "status.done": "تم!",
      "res.title": "النتائج",
      "col.name": "الملف",
      "col.start": "البداية",
      "col.end": "النهاية",
      "col.dur": "المدة",
      "col.conf": "الثقة",
      "exp.title": "تصدير",
      "exp.labels": "Audacity Labels",
      "exp.copyJson": "نسخ JSON",
      "footer.note": "يعمل محلياً 100% داخل متصفحك — لا يتم رفع أي ملفات إلى أي خادم.",
      "footer.madeIn": "صنع في بلاد الرافدين 🇮🇶",
      "msg.noClips": "أضف ملفات صوتية أولاً",
      "msg.badOffset": "قيمة الإزاحة غير صحيحة",
      "msg.noRef": "يجب تعيين ملف مرجعي بنجمة ★ في هذا الوضع",
      "msg.silent": "صامت بالكامل — تم تجاهل قصّ الصمت",
      "msg.copied": "تم نسخ JSON إلى الحافظة",
      "msg.done": "تم إنشاء التايم كود بنجاح",
      "msg.cannotPlay": "«{name}»: تعذّر قراءة هذا الملف في المتصفح — تم تخطيه",
      "msg.noAudio": "تنبيه: لا يوجد مسار صوتي قابل للقراءة في «{name}»",
      "msg.split": "تم تقسيم الملف إلى {n} أجزاء بسبب فجوات صمت طويلة",
      "res.unmatched": "لا تطابق موثوق — وُضِع تسلسلياً بعد نهاية المرجع",
      "res.longerThanRef": "المقطع أطول من الملف المرجعي",
      "res.partial": "تطابق جزئي — المقطع يتجاوز حدود المرجع",
      "res.anchor": "الخط الزمني الأساسي (الأطول) — باقي الملفات محاذاة داخله",
      "col.drift": "الانجراف"
    },
    en: {
      "app.title": "Zamen • زامِن",
      "app.subtitle": "Auto-sync audio & video clips on your timeline — runs fully in your browser, no API needed",
      "app.tagline": "Every clip finds its moment",
      "drop.title": "Drop audio or video files here or click to browse",
      "drop.hint": "MP3 · WAV · M4A · OGG · FLAC · MP4 · WEBM · MOV",
      "clips.title": "Selected files",
      "clips.sortByName": "Sort by name",
      "clips.clearAll": "Clear all",
      "clips.up": "Move up",
      "clips.down": "Move down",
      "clips.remove": "Remove",
      "clips.starOn": "Set as reference",
      "clips.starOff": "Unset reference",
      "set.title": "Settings",
      "set.mode": "Mode",
      "set.modeSync": "Smart sync all files (no reference)",
      "set.modeSeq": "Sequential timeline (file after file)",
      "set.modeRef": "Auto-match to reference",
      "set.refHint": "In Match mode: mark the reference recording with ★ (longest is picked automatically); every other clip is located inside it by audio correlation, with a confidence score per match. In Smart Sync mode no reference is needed — files are aligned against each other automatically.",
      "set.trim": "Trim leading/trailing silence",
      "set.drift": "Detect & correct speed drift",
      "set.thresh": "Silence threshold",
      "set.gap": "Gap between clips (sec)",
      "set.offset": "Time offset",
      "set.offsetHint": "Added to all times — e.g. 90, 1:30 or 1:02:03 (negative allowed)",
      "set.tcFormat": "Timecode format",
      "set.tcMs": "HH:MM:SS.mmm",
      "set.tcFrames": "HH:MM:SS:FF (frames)",
      "set.fps": "FPS",
      "set.conf": "Acceptance confidence",
      "btn.process": "Build timecode",
      "status.decoding": "Decoding {a}/{b} …",
      "status.extract": "Extracting audio from video \u201c{name}\u201d ({a}/{b}) …",
      "status.analyzing": "Analyzing silence …",
      "status.matching": "Matching \u201c{name}\u201d ({a}/{b}) …",
      "status.resampling": "Preparing match data …",
      "status.done": "Done!",
      "res.title": "Results",
      "col.name": "File",
      "col.start": "Start",
      "col.end": "End",
      "col.dur": "Duration",
      "col.conf": "Confidence",
      "exp.title": "Export",
      "exp.labels": "Audacity Labels",
      "exp.copyJson": "Copy JSON",
      "footer.note": "100% local — nothing is uploaded to any server.",
      "footer.madeIn": "Made in Mesopotamia 🇮🇶",
      "msg.noClips": "Add some audio files first",
      "msg.badOffset": "Invalid offset value",
      "msg.noRef": "Mark a reference file with ★ in this mode",
      "msg.silent": "Completely silent — silence trim skipped",
      "msg.copied": "JSON copied to clipboard",
      "msg.done": "Timecode built successfully",
      "msg.cannotPlay": "\u201c{name}\u201d: the browser cannot read this file — skipped",
      "msg.noAudio": "Warning: no readable audio track in \u201c{name}\u201d",
      "msg.split": "File split into {n} parts due to long silence gaps",
      "res.unmatched": "No reliable match — placed after reference end",
      "res.longerThanRef": "Clip is longer than the reference file",
      "res.partial": "Partial match — clip extends beyond the reference bounds",
      "res.anchor": "Anchor timeline (longest) — all other files are aligned into it",
      "col.drift": "Drift"
    }
  };

  let lang = localStorage.getItem("tcb-lang") || "ar";

  function t(key, vars) {
    let s = (dict[lang] && dict[lang][key]) || dict.en[key] || key;
    if (vars) for (const k in vars) s = s.replaceAll("{" + k + "}", vars[k]);
    return s;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = lang === "ar"
      ? "Zamen • زامِن | مزامن المقاطع الصوتية والفيديو"
      : "Zamen • زامِن | Audio & Video Auto-Sync";
    document.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    const btn = document.getElementById("langBtn");
    if (btn) btn.textContent = lang === "ar" ? "English" : "العربية";
  }

  function setLang(l) {
    lang = l;
    localStorage.setItem("tcb-lang", l);
    apply();
  }

  function toggle() {
    setLang(lang === "ar" ? "en" : "ar");
  }

  return { t, apply, setLang, toggle, get lang() { return lang; } };
})();
