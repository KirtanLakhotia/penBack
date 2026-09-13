import 'dotenv/config'
import Groq from 'groq-sdk'
import { GoogleGenAI, Type } from "@google/genai";
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
})
    
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

async function grok_transcription(audioFile) {
    const transcription = await groq.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-large-v3',
        response_format: 'json',
        temperature: 0
    });
    if (!transcription) {
        throw new Error('Groq returned an empty transcription')
    }
    return transcription;
}

function extractWordAnnotations(interaction) {
  const words = [];
  for (const step of interaction.steps ?? []) {
    for (const content of step.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "word_info") {
          words.push(annotation);
        }
      }
    }
  }
  return words;
}


async function getDiarization(interaction) {
    const diarization = [];
    const words = extractWordAnnotations(interaction);
    let currSpeaker  = "spk:0";
    let data = "";
    let start_offset = words[0]?.start_offset || '0s';
    let end_offset = '0s';
    for (const w of words) {
        if (currSpeaker !== w.speaker) {
            diarization.push(
                {
                    speaker: currSpeaker,
                    text: data.trim(),
                    start_offset: start_offset,
                    end_offset: end_offset
                }
            )
            currSpeaker = w.speaker;
            // console.log(`\n${currSpeaker}:${data}`); 
            data ="" ;
            start_offset = w.start_offset ;
        }
        end_offset = w.end_offset ;
        data+= w.text + " ";
    }
    // console.log(`\n${currSpeaker}:${data}`);
    diarization.push(
        {
            speaker: currSpeaker,
            text: data.trim(),
            start_offset: start_offset,
            end_offset: end_offset
        }
    )
    return diarization ;
} ;

async function  gemini_transcription(audioFile) {

    const uploadedFile = await ai.files.upload({
        file: audioFile,
        config: {
            mimeType: audioFile.type,
        },
    });
    const interaction = await ai.interactions.create({
    model: "gemini-3.5-transcribe",
    input: [
        {
        type: "audio",
        uri: uploadedFile.uri,
        mime_type: uploadedFile.mimeType,
        },
    ],
    generation_config: {
        transcription_config: {
        mode: {
            type: "verbatim",
            diarization_mode: "speaker",
            timestamp_granularities: ["word"],
        },
        },
    },
    });

    if (!interaction) {
        throw new Error("Gemini returned an empty transcription");
    }
    const transcription = interaction.output_text;
    
    const diarization = await getDiarization(interaction);

    return {transcription, diarization};
}

export { 
grok_transcription,
gemini_transcription
};
