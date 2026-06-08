import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  calculateAutoFps,
  findSidecarSubtitle,
  parseSubtitleContent,
} from "./prepare-video.mjs";

test("findSidecarSubtitle returns the exact same-basename .srt file", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-video-skill-"));
  try {
    const videoPath = join(dir, "demo.video.mp4");
    const subtitlePath = join(dir, "demo.video.srt");
    writeFileSync(videoPath, "not a real video");
    writeFileSync(subtitlePath, "1\n00:00:00,000 --> 00:00:01,000\nhello\n");

    assert.equal(findSidecarSubtitle(videoPath), subtitlePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseSubtitleContent parses SRT blocks and cleans text", () => {
  const parsed = parseSubtitleContent(`1
00:00:00,000 --> 00:00:03,280
<i>Hello</i> &amp; welcome

2
00:00:03,280 --> 00:00:07,480
to the demo.
`);

  assert.deepEqual(parsed, [
    { start: "00:00:00", end: "00:00:03", text: "Hello & welcome" },
    { start: "00:00:03", end: "00:00:07", text: "to the demo." },
  ]);
});

test("calculateAutoFps uses lower sampling for longer videos", () => {
  assert.equal(calculateAutoFps(30), 2);
  assert.equal(calculateAutoFps(180), 1);
  assert.equal(calculateAutoFps(600), 0.5);
  assert.equal(calculateAutoFps(1800), 0.2);
  assert.equal(calculateAutoFps(7200), 0.1);
});
