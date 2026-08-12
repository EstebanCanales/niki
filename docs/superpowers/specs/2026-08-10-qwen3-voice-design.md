# Qwen3-TTS voice interaction design

## Goal

Make Niki's user-agent voice interaction feel like a natural autonomous assistant in Spanish, while using Qwen3-TTS as the local synthesis provider.

## Current-state findings

- The macOS client already has VAD-based conversation loops and pauses recording while Niki is speaking.
- The backend currently launches Piper for each synthesis request, so a voice turn pays the model startup cost repeatedly.
- The visible client copy mixes English and Spanish, and the TTS sanitizer leaves several chat-format constructs that sound unnatural when spoken.

## Design

The backend owns one persistent Python Qwen3-TTS worker. It loads `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` once, accepts newline-delimited JSON requests, and returns newline-delimited JSON responses containing PCM WAV audio encoded as base64. Node serializes requests through a queue so the worker has exactly one in-flight request. The existing `/voice/synthesize` HTTP contract remains unchanged.

Qwen speaker `Serena` is the default because it is documented as a warm, gentle voice and supports Spanish. Existing Piper IDs are accepted as aliases and map to Serena, so persisted Niki preferences continue to work. The environment can override the Python executable, model, device, speaker, and style instruction.

The client continues to own turn-taking: VAD listens until sustained silence, sends the transcript to the voice channel, waits for the streamed answer and Qwen audio to finish, then listens again. During playback it does not record, preventing the assistant's own audio from becoming the next user turn. Text sent to TTS is converted to plain spoken prose by removing code fences, links, list markers, headings, and markdown emphasis.

## Copy and language rules

- Voice controls and voice errors use clear Spanish.
- Voice responses are instructed by the runtime to be one to three short sentences by default, with no markdown, lists, URLs, or emoji.
- Technical failures are logged for diagnostics but shown to the user as an actionable Spanish message.

## Setup and failure behavior

The backend reports TTS as available only when the Qwen worker script and configured Python environment exist. The worker returns a structured error if `qwen-tts`, `torch`, or `soundfile` is missing. The Node service terminates the worker during module shutdown and rejects any pending request.

## Verification

- Compile the Qwen worker without launching it.
- Run repository diff checks.
- Inspect the backend changes for the existing HTTP response contract and the client changes for Qwen voice migration and Spanish voice copy.
- Do not start the backend or macOS app during this task.
