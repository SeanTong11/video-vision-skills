---
name: video-perception
description: Use when the user asks Codex to watch, inspect, summarize, or analyze a local video file, especially when a same-basename .srt subtitle file should be used instead of Whisper.
---

# Video Perception

Use this skill to analyze videos with local shell tools and the bundled helper
script.

## Workflow

1. Resolve the video input.
   - For a local path, use it directly.
   - For a YouTube URL, download it first with `yt-dlp` if available, then work on
     the downloaded local file.

2. Prefer same-basename subtitles over audio transcription.
   - For `demo.mp4`, look for `demo.srt` in the same directory.
   - If it exists, treat it as the transcript source.
   - If it does not exist, continue with visual analysis and say that no sidecar
     subtitles were found.
   - Do not run Whisper unless the user explicitly asks for audio transcription.

3. Prepare video evidence with the bundled helper script:

   ```bash
   node .agents/skills/video-perception/scripts/prepare-video.mjs \
     --path /absolute/path/to/video.mp4 \
     --transcript auto \
     --fps auto \
     --resolution 512 \
     --max-frames 40
   ```

   The script prints JSON containing metadata, sidecar subtitle segments if
   available, and extracted frame image paths.

4. Inspect frames from the script output.
   - For short videos, inspect an evenly distributed sample of the extracted
     frames.
   - For long videos, use subtitles and metadata to choose focused ranges, then
     rerun the script with `--start HH:MM:SS --end HH:MM:SS --max-frames 20`.
   - Increase `--resolution` to 768 or 1024 when reading on-screen text.

5. Answer from evidence.
   - Combine timestamped frame observations with sidecar subtitle content.
   - Mention when there was no sidecar subtitle and the answer is visual-only.
   - If the user asks for exact speech but no `.srt` exists, explain that this
     workflow does not transcribe audio by default.

## Time Citation Rules

- Every claim about video content must cite a timestamp or time range.
- Cite the nearest frame timestamp for visual observations, such as cursor
  position, chart state, slide content, gestures, or scene changes.
- Cite subtitle segment timestamps for spoken content.
- If a visual event occurs between sampled frames, cite the narrowest observed
  range, for example `[00:43:45-00:43:49]`.
- Do not write statements like "his mouse points at this candle" without saying
  when it happens.
- Prefer compact inline citations: `[00:43:48]`, `[00:43:38-00:43:58]`.

## Helper Options

- `--transcript auto`: read same-basename `.srt` when present.
- `--transcript sidecar`: require sidecar subtitle behavior, but still does not
  fall back to Whisper.
- `--transcript none`: skip subtitle lookup.
- `--fps auto`: sample more densely for short videos and more sparsely for long
  videos.
- `--start` / `--end`: limit extraction to a focused time range.
- `--out`: choose an output directory for extracted frames.

## Constraints

- Keep extraction small at first; drill into specific moments only when needed.
- Do not create persistent project files from extracted frames unless the user
  asks. The helper defaults to a temporary output directory.
- Keep the workflow local to the skill files and bundled helper script.
