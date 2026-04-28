import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Speko } from '@spekoai/sdk';

const apiKey = process.env['SPEKO_API_KEY'];
if (!apiKey) {
  console.error('Missing SPEKO_API_KEY. Generate one at https://platform.speko.dev/api-keys');
  process.exit(1);
}

const speko = new Speko({
  apiKey,
  baseUrl: process.env['SPEKO_BASE_URL'] ?? 'http://localhost:3000',
});

async function main() {
  console.log('=== speko.transcribe ===');
  const audioPath = resolve(import.meta.dirname, '..', 'sample.wav');
  let audio: Uint8Array;
  try {
    audio = await readFile(audioPath);
  } catch {
    console.warn(`(no sample.wav at ${audioPath} — drop a short WAV clip there to test transcribe)`);
    audio = new Uint8Array(0);
  }

  if (audio.byteLength > 0) {
    const transcription = await speko.transcribe(audio, {
      language: 'en',
      optimizeFor: 'accuracy',
    });
    console.log(transcription);
  }

  console.log('\n=== speko.complete ===');
  const completion = await speko.complete({
    messages: [
      { role: 'user', content: 'Say hi in one short sentence.' },
    ],
    intent: { language: 'en' },
  });
  console.log(completion);

  console.log('\n=== speko.synthesize ===');
  const synth = await speko.synthesize('Welcome to Speko.', {
    language: 'en',
  });
  const ext = synth.contentType.includes('mpeg') ? 'mp3' : 'pcm';
  const outPath = resolve(import.meta.dirname, '..', `out.${ext}`);
  await writeFile(outPath, synth.audio);
  console.log({
    bytes: synth.audio.byteLength,
    contentType: synth.contentType,
    provider: synth.provider,
    wroteTo: outPath,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
