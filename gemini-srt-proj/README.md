# Quick Start - Gemini Video-to-SRT (Node.js)

Get up and running in 5 minutes.

## 1. Get Your API Key (1 min)

1. Go to https://aistudio.google.com/app/apikey
2. Click **"Create API Key"**
3. Copy the key

## 2. Install Dependencies (1 min)

```bash
npm install
```

## 3. Set API Key

**macOS/Linux:**
```bash
export GEMINI_API_KEY="your_api_key_here"
```

**Windows (PowerShell):**
```powershell
$env:GEMINI_API_KEY="your_api_key_here"
```

**Windows (Command Prompt):**
```cmd
set GEMINI_API_KEY=your_api_key_here
```

## 4. Run (1-2 min)

```bash
node gemini-to-srt.js "Childrens.Hospital.S06E01.1080p.WEBRip.x265-INFINITY.mp4"
```

**Output:** `video.srt` ✓

## Done!

Use the `.srt` file with any video player:
- **VLC:** Subtitles → Load External Subtitle File
- **FFmpeg:** `ffplay -vf subtitles=output.srt video.mp4`
- **Browser:** Add `<track>` element to `<video>` tag

## Common Commands

```bash
# Basic
node gemini-to-srt.js video.mp4

# Custom output
node gemini-to-srt.js video.mp4 --output subtitles.srt

# Inline API key (not recommended)
node gemini-to-srt.js video.mp4 --api-key YOUR_KEY

# Test setup
npm test

# Help
node gemini-to-srt.js --help
```

## Supported Formats
.mp4 .mov .webm .mpeg .flv .wmv .3gp

## Limits
- Max 45 minutes with audio
- Max 1 hour without audio

## Issues?

Run setup test:
```bash
npm test
```

See `README-NODE.md` for detailed troubleshooting.