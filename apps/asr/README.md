# @tv/asr

ASR server app for the TV monorepo.

- Provides `POST /controlAsr` (and `POST /asr/controlAsr` alias) which accepts an `asrArgs` JSON object.
- Uses an ASR provider to transcribe video files into `.srt` subtitles.

## Secrets

Place the Mistral ASR API key in:

- `apps/asr/secrets/mistral-asr-key.txt`

On the remote host this becomes:

- `/root/dev/apps/tv/apps/asr/secrets/mistral-asr-key.txt`

For OpenAI GPT-4o-Transcribe, place the OpenAI API key in:

- `apps/asr/secrets/openai-asr-key.txt`

On the remote host this becomes:

- `/root/dev/apps/tv/apps/asr/secrets/openai-asr-key.txt`

## Provider

`POST /controlAsr` accepts a `provider` field:

- `provider: "voxtral"` (default)
- `provider: "gpt"`

Notes:

- The GPT provider uses OpenAI's `/v1/audio/transcriptions` endpoint with model `whisper-1`.

## Model

The server uses Mistral's `POST /v1/audio/transcriptions` endpoint.

- Default model: `voxtral-small-latest`
- Override with env var: `MISTRAL_ASR_MODEL`

## Timeouts

- Default API timeout: 10 minutes
- Override with env var: `MISTRAL_ASR_TIMEOUT_MS` (milliseconds)

Example values:

- 5 minutes: `MISTRAL_ASR_TIMEOUT_MS=300000`
- 10 minutes (default): `MISTRAL_ASR_TIMEOUT_MS=600000`
- 20 minutes: `MISTRAL_ASR_TIMEOUT_MS=1200000`

How to change it:

- Temporarily (one run / current shell):
	- `export MISTRAL_ASR_TIMEOUT_MS=1200000`
- Persistently for the deployed ASR process (PM2):
	- Edit the `tv-asr` app in the repo PM2 config: `ecosystem.config.cjs`
	- Add `MISTRAL_ASR_TIMEOUT_MS: '1200000'` under `env` (and `env_production` if you use it)
	- Reload with updated env:
		- `pm2 reload ecosystem.config.cjs --only tv-asr --update-env`
		- (or) `pm2 restart tv-asr --update-env`
	- Verify:
		- `pm2 env tv-asr | grep MISTRAL_ASR_TIMEOUT_MS`
		- Start a new ASR job and confirm the ASR log “Configuration” shows `API Timeout: ...s`

Notes:

- Voxtral `chat/completions (audio)` can exceed 2 minutes for 120s chunks during busy periods; increasing this avoids unnecessary retries.
- Higher timeouts reduce false-failures but can make a genuinely-stuck request take longer to abort.

## Notes

- Requires `ffmpeg` and `ffprobe` available on the host.
- Logs are written under `apps/asr/logs/` in the deployed directory tree.
