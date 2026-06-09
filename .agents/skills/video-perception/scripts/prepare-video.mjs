#!/usr/bin/env node
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  basename,
  extname,
  join,
  parse,
  resolve,
} from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function calculateAutoFps(durationSeconds) {
  if (durationSeconds < 60) return 2;
  if (durationSeconds < 300) return 1;
  if (durationSeconds < 900) return 0.5;
  if (durationSeconds < 3600) return 0.2;
  return 0.1;
}

function formatHMS(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function parseHMS(value) {
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) {
    throw new Error(`Invalid HH:MM:SS timestamp: ${value}`);
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function parseSubtitleTimestamp(raw) {
  const match = raw.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function decodeSubtitleText(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSubtitleContent(raw) {
  const normalized = raw.replace(/\r/g, "");
  const blocks = normalized.split(/\n{2,}/);
  const transcription = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;

    const [startRaw, endRaw] = lines[timingIndex]
      .split("-->")
      .map((part) => part.trim());
    if (!startRaw || !endRaw) continue;

    const text = decodeSubtitleText(lines.slice(timingIndex + 1).join(" "));
    if (!text) continue;

    transcription.push({
      start: formatHMS(parseSubtitleTimestamp(startRaw)),
      end: formatHMS(parseSubtitleTimestamp(endRaw)),
      text,
    });
  }

  return transcription;
}

export function findSidecarSubtitle(videoPath) {
  const parsed = parse(resolve(videoPath));
  const candidate = join(parsed.dir, `${parsed.name}.srt`);
  return existsSync(candidate) ? candidate : null;
}

function safeName(value) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "video";
}

export function buildDefaultOutputDir(videoPath, timestamp = Date.now(), cwd = process.cwd()) {
  const stem = safeName(basename(videoPath, extname(videoPath)));
  return join(cwd, ".video-perception", `${stem}-${timestamp}`);
}

function loadSidecarTranscript(videoPath) {
  const subtitlePath = findSidecarSubtitle(videoPath);
  if (!subtitlePath) {
    return {
      source: "none",
      path: null,
      segments: [],
      warning: `No same-basename .srt file found next to ${basename(videoPath)}`,
    };
  }

  return {
    source: "sidecar-srt",
    path: subtitlePath,
    segments: parseSubtitleContent(readFileSync(subtitlePath, "utf8")),
  };
}

async function getVideoMetadata(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);

  const probe = JSON.parse(stdout);
  const videoStream = probe.streams.find((s) => s.codec_type === "video");
  const audioStream = probe.streams.find((s) => s.codec_type === "audio");
  const format = probe.format ?? {};
  const durationSeconds = Number.parseFloat(
    format.duration ?? videoStream?.duration ?? "0",
  );
  const fpsRaw = videoStream?.r_frame_rate ?? "30/1";
  const [num, den] = fpsRaw.split("/").map(Number);

  return {
    path: videoPath,
    duration: formatHMS(durationSeconds),
    duration_seconds: durationSeconds,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    resolution: `${videoStream?.width ?? 0}x${videoStream?.height ?? 0}`,
    codec: videoStream?.codec_name ?? "unknown",
    original_fps: Math.round(num / (den || 1)),
    has_audio: Boolean(audioStream),
  };
}

async function extractFrames(videoPath, options) {
  const {
    fps,
    resolution,
    outputDir,
    startTime,
    endTime,
    maxFrames,
  } = options;
  mkdirSync(outputDir, { recursive: true });

  const args = [];
  if (startTime) args.push("-ss", startTime);
  args.push("-i", videoPath);
  if (endTime) args.push("-to", endTime);
  args.push(
    "-vf",
    `fps=${fps},scale=${resolution}:-1`,
    "-frames:v",
    String(maxFrames),
    "-q:v",
    "5",
    "-y",
    join(outputDir, "frame_%04d.jpg"),
  );

  await execFileAsync("ffmpeg", args, { maxBuffer: 20 * 1024 * 1024 });

  const files = readdirSync(outputDir)
    .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
    .sort();
  const offset = startTime ? parseHMS(startTime) : 0;

  return files.map((file, index) => ({
    timestamp: formatHMS(offset + index / fps),
    path: join(outputDir, file),
  }));
}

function parseArgs(argv) {
  const args = {
    fps: "auto",
    resolution: 512,
    maxFrames: 80,
    transcript: "auto",
  };

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === "--path") args.path = argv[++i];
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--fps") args.fps = argv[++i];
    else if (item === "--resolution") args.resolution = Number(argv[++i]);
    else if (item === "--max-frames") args.maxFrames = Number(argv[++i]);
    else if (item === "--start") args.startTime = argv[++i];
    else if (item === "--end") args.endTime = argv[++i];
    else if (item === "--transcript") args.transcript = argv[++i];
    else if (!args.path) args.path = item;
    else throw new Error(`Unknown argument: ${item}`);
  }

  if (!args.path) {
    throw new Error(
      "Usage: prepare-video.mjs --path <video> [--out <dir>] [--fps auto|number] [--resolution 512] [--max-frames 80] [--start HH:MM:SS] [--end HH:MM:SS] [--transcript auto|sidecar|none]",
    );
  }
  if (!["auto", "sidecar", "none"].includes(args.transcript)) {
    throw new Error("--transcript must be one of: auto, sidecar, none");
  }

  args.path = resolve(args.path);
  if (!existsSync(args.path)) {
    throw new Error(`Video file not found: ${args.path}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const metadata = await getVideoMetadata(args.path);
  const fps = args.fps === "auto" ? calculateAutoFps(metadata.duration_seconds) : Number(args.fps);
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("--fps must be 'auto' or a positive number");
  }

  const rootOutputDir = args.out
    ? resolve(args.out)
    : buildDefaultOutputDir(args.path);
  const framesDir = join(rootOutputDir, "frames");

  const transcript = args.transcript === "none"
    ? { source: "none", path: null, segments: [] }
    : loadSidecarTranscript(args.path);

  const frames = await extractFrames(args.path, {
    fps,
    resolution: args.resolution,
    outputDir: framesDir,
    startTime: args.startTime,
    endTime: args.endTime,
    maxFrames: args.maxFrames,
  });

  const result = {
    metadata,
    extraction: {
      fps,
      resolution: args.resolution,
      start_time: args.startTime ?? null,
      end_time: args.endTime ?? null,
      output_dir: rootOutputDir,
    },
    transcript,
    frames: {
      count: frames.length,
      directory: framesDir,
      items: frames,
    },
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
