# Zamen • زامِن

> Every clip finds its moment

## Features

- Select multiple files from your device: **audio and video together** (MP3, WAV, M4A, OGG, FLAC, MP4, WEBM, MOV ...)
- The audio track of video files is extracted automatically and synchronized with the audio clips
- **Smart sync for all files**: no reference needed — the longest file becomes the anchor timeline and every other file is located inside it OR inside any already-placed clip; spanned/continuation clips and partial overlaps are supported
- **Speed-drift detection & correction** between recorders via linear fitting over short chunks, reported in ms/min
- Manual match mode: mark a reference with ★ and locate every clip inside it
- Sequential mode: cumulative timing with edge-silence trimming at an adjustable dB threshold
- Reorder files by drag & drop or with buttons
- Time offset field to sync the start with your video
- Timecode format in frames `HH:MM:SS:FF` or milliseconds `HH:MM:SS.mmm`
- Export results as: `CSV` · `SRT` · `JSON` · `Audacity Labels` · `EDL (CMX3600)` · `TXT`
- Bilingual interface: Arabic and English
- No API — everything is processed locally in your browser, no files are uploaded

## The three modes and when to use them

| Mode | Benefit | Use when |
|---|---|---|
| **Smart sync all** | Fully automatic alignment without a reference: longest file anchors the timeline, chaining connects spanned clips, speed drift is measured and corrected, partial overlaps supported | Several recordings (cameras/recorders) of the same event and you don't know which is most reliable |
| **Match to reference ★** | You pick the reference recording yourself; every other clip is located inside it with a confidence score | You have an obvious master recording (e.g. the video's own audio) and only need the positions of the rest inside it |
| **Sequential** | Builds a timeline from the list order, optionally trimming edge silence with a regular gap | Non-overlapping consecutive clips: voiceover segments, podcast episodes, rejoining split recordings |

## Export formats and what they are for

| Format | Benefit |
|---|---|
| **FCPXML** | DaVinci Resolve & Final Cut — opens a full timeline with every clip on its OWN track (unlimited lanes): ideal for one-master-audio + multiple camera angles; on import you locate your files' folder once and sources relink by name |
| **EDL (CMX3600)** | Direct import into Premiere Pro, DaVinci Resolve and Final Cut — builds events at their correct positions, splits overlapping clips onto separate audio tracks (A/A2/A3/A4), auto-links sources by file name, and includes confidence/drift comments plus the suggested speed percentage |
| **CSV** | Review and sorting in Excel/Google Sheets — all data in columns (raw seconds + timecode + confidence + drift) |
| **JSON** | Automation and integration — structured data for post-processing scripts or other tools |
| **SRT** | Quick visual check — clip names appear as subtitles over the video in any player so you can verify positions |
| **Audacity Labels** | Ready-made markers in Audacity (Import ← Labels) for cleaning up clips in place |
| **TXT** | Quick reading or simple sharing without any editing software |

## How it works

1. **Decoding**: files are read via Web Audio API and converted to mono at 8kHz. For videos, direct audio-track decoding is attempted first; if unavailable the file plays internally (up to 8x speed) while its audio is captured through Web Audio — all locally in the browser
2. **Silence detection**: audio content boundaries are found by RMS analysis with an adjustable dB threshold
3. **Sequencing**: each clip's position is computed cumulatively according to list order, with the configured gap between clips
4. **Smart matching — chunk voting**: every clip is split into short chunks (~2.5 s) short enough that clock drift is negligible inside them. Each chunk is located independently by FFT-based Normalized Cross-Correlation; a least-squares line through the surviving chunk positions yields both the precise placement **and the drift rate**
5. **Chaining**: files that do not touch the anchor are searched inside previously placed clips, so spanned recordings connect automatically; partial overlaps (clips extending past a source's edges) are supported
6. **Offset**: the offset is added to all timings, then export files are generated
