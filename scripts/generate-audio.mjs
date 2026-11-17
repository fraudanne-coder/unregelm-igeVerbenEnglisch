import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

const MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

const OUTPUT_FORMAT =
  process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";

if (!API_KEY) {
  throw new Error("ELEVENLABS_API_KEY fehlt.");
}

if (!VOICE_ID) {
  throw new Error("ELEVENLABS_VOICE_ID fehlt.");
}

const verbsFile = "verbs.json";
const audioFolder = "audio";
const manifestFile = path.join(audioFolder, ".manifest.json");

const verbs = JSON.parse(
  await readFile(verbsFile, "utf8")
);

if (!Array.isArray(verbs)) {
  throw new Error("verbs.json muss eine Liste enthalten.");
}

await mkdir(audioFolder, { recursive: true });

let manifest = {};

try {
  manifest = JSON.parse(
    await readFile(manifestFile, "utf8")
  );
} catch {
  manifest = {};
}

function cleanId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createHash(text) {
  return crypto
    .createHash("sha256")
    .update(`${VOICE_ID}|${MODEL_ID}|${OUTPUT_FORMAT}|${text}`)
    .digest("hex");
}

async function fileExists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function createAudio(text, filename) {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/` +
    `${encodeURIComponent(VOICE_ID)}` +
    `?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg"
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `ElevenLabs-Fehler ${response.status}: ${errorText}`
    );
  }

  const audioData = Buffer.from(
    await response.arrayBuffer()
  );

  await writeFile(filename, audioData);
}

for (const verb of verbs) {
  if (!verb.id) {
    console.warn("Ein Verb ohne id wird übersprungen.");
    continue;
  }

  const id = cleanId(verb.id);

  const forms = [
    verb.infinitive,
    verb.past,
    verb.participle
  ]
    .map((form) => String(form || "").trim())
    .filter(Boolean);

  if (forms.length === 0) {
    console.warn(`Keine Formen für "${id}" gefunden.`);
    continue;
  }

  const speechText = forms.join(". ");
  const outputFile = path.join(audioFolder, `${id}.mp3`);
  const manifestKey = `${id}.mp3`;
  const hash = createHash(speechText);

  const alreadyExists =
    manifest[manifestKey] === hash &&
    await fileExists(outputFile);

  if (alreadyExists) {
    console.log(`Übersprungen: ${outputFile}`);
    continue;
  }

  console.log(`Erzeuge: ${outputFile}`);

  await createAudio(speechText, outputFile);

  manifest[manifestKey] = hash;

  // Kurze Pause zwischen den Anfragen
  await new Promise((resolve) => setTimeout(resolve, 300));
}

await writeFile(
  manifestFile,
  JSON.stringify(manifest, null, 2) + "\n"
);

console.log("Alle Audiodateien wurden erstellt.");
