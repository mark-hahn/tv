# @tv/asr

ASR server app for the TV monorepo.

- Provides `POST /controlAsr` (and `POST /asr/controlAsr` alias) which accepts an `asrArgs` JSON object.
- Uses Mistral's Voxtral ASR API to transcribe video files into `.srt` subtitles.

## Secrets

Place the Mistral ASR API key in:

- `apps/asr/secrets/mistral-asr-key.txt`

On the remote host this becomes:

- `/root/dev/apps/tv/apps/asr/secrets/mistral-asr-key.txt`

## Model

The server uses Mistral's `POST /v1/audio/transcriptions` endpoint.

- Default model: `voxtral-small-latest`
- Override with env var: `MISTRAL_ASR_MODEL`

## Notes

- Requires `ffmpeg` and `ffprobe` available on the host.
- Logs are written under `apps/asr/logs/` in the deployed directory tree.
