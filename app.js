import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

import supabase from './supabase.js'
import multer from 'multer'
import cors from 'cors'
import 'dotenv/config'

import Groq from 'groq-sdk'

import { GoogleGenAI, Type } from "@google/genai";
import { saveRecording, saveTodos, getRecordings ,getTodos } from "./db.js";




const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json())
const port = process.env.PORT || 4000

app.use(cors())

// multer memory storage for forwarding uploads to Supabase
const upload = multer({ storage: multer.memoryStorage() })

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
})

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

async function generateSummaryAndTodos(transcript) {

    const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",

        contents: `
You are an AI assistant.

Analyze the following transcript.

Return:

1. A clear and useful description.
2. Only the important action items that the user actually needs to do.

Rules for todos:
- Only include genuinely important actions.
- Do not convert general information into a todo.
- Do not create todos from casual statements.
- Do not invent tasks.
- If there are no important actions, return an empty array.
- Keep each todo short and actionable.

Transcript:

${transcript}
`,

        config: {
            responseMimeType: "application/json",

            responseSchema: {
                type: Type.OBJECT,

                properties: {
                    summary: {
                        type: Type.STRING
                    },

                    todos: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.STRING
                        }
                    }
                },

                required: ["summary", "todos"]
            }
        }
    });

    return JSON.parse(response.text);
}


app.post('/api/files/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            })
        }

        const file = req.file

        console.log('Received file:')
        console.log('Name:', file.originalname)
        console.log('Type:', file.mimetype)
        console.log('Size:', file.size)

        const fileName = `${Date.now()}-${file.originalname}`

        const { data, error } = await supabase.storage
            .from('penProject')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                upsert: false
            })

        if (error) {
            console.error('Supabase upload error:', error)

            return res.status(500).json({
                success: false,
                message: 'Failed to upload file'
            })
        }

        // create a signed URL (temporary) so frontend can stream/play the file
        // let signedUrl = null
        // try {
        //     const { data: signedData, error: signedError } = await supabase.storage
        //         .from('penProject')
        //         .createSignedUrl(data.path, 60 * 60) // 1 hour

        //     if (!signedError) signedUrl = signedData?.signedUrl || null
        // } catch (e) {
        //     signedUrl = null
        // }
        // console.log('File uploaded successfully:', data.path)
        // console.log('Signed URL:', signedUrl)

        // lets convert the audio to the transcript 
        const audioFile = new File(
            [file.buffer],
            file.originalname,
            {
                type: file.mimetype
            }
        )

        console.log('Sending audio to Groq...')

        const transcription = await groq.audio.transcriptions.create({
            file: audioFile,
            model: 'whisper-large-v3',
            response_format: 'json',
            temperature: 0
        })

        const transcript = transcription.text

        console.log('Transcript:')
        console.log(transcript)


        // const {summ , toto} = something something
        const { summary, todos } =
        await generateSummaryAndTodos(transcript);
        console.log('---------------------------------------------------------')
        console.log(summary);
        console.log(todos);

        // insert into database like something thing {{meta things} ,trans , summ , toto} ;
        const recording  = await saveRecording({
            user_id: 1, // replace with actual user
            audioPath: data.path,
            title: file.originalname,
            transcript: transcript,
            summary: summary,
            durationSeconds:Math.round(file.size / 1024 / 1024 * 1000 )// approximate duration in seconds
        });

       const todoSaved =  await saveTodos(recording.recording_id, todos);

        res.json({
            success: true,
            message: 'File uploaded successfully',
            path: data.path,
            name: fileName,
            size: file.size,
            mimeType: file.mimetype
        })

    } catch (error) {
        console.error(error)

        res.status(500).json({
            success: false,
            message: 'Something went wrong'
        })
    }
})

app.get('/api/files', async (req, res) => {
    try {
        const { data, error } = await supabase.storage
            .from('penProject')
            .list('', {
                limit: 100,
                offset: 0,
                sortBy: {
                    column: 'created_at',
                    order: 'desc'
                }
            })

        if (error) {
            console.error('Supabase list error:', error)

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve files'
            })
        }

        // build public URL for each file when possible
        const files = await Promise.all(data.map(async (file) => {
            // prefer signed URL for private buckets
            let signedUrl = null
            try {
                const { data: signedData, error: signedError } = await supabase.storage
                    .from('penProject')
                    .createSignedUrl(file.name, 60 * 60) // 1 hour
                if (!signedError) signedUrl = signedData?.signedUrl || null
            } catch (e) {
                signedUrl = null
            }

            // fallback to public url if available
            let publicUrl = null
            try {
                const { data: urlData, error: urlError } = supabase.storage
                    .from('penProject')
                    .getPublicUrl(file.name)
                if (!urlError) publicUrl = urlData?.publicUrl || urlData?.public_url || null
            } catch (e) {
                publicUrl = null
            }

            return {
                name: file.name,
                id: file.id,
                size: file.metadata?.size || 0,
                type: file.metadata?.mimetype || null,
                createdAt: file.created_at,
                updatedAt: file.updated_at,
                signedUrl,
                publicUrl,
            }
        }))

        res.json({ success: true, files })

    } catch (error) {
        console.error(error)

        res.status(500).json({
            success: false,
            message: 'Something went wrong'
        })
    }
})

app.post('/recordings', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'userId is required'
            });
        }

        const recordings = await getRecordings(userId);

        for (const recording of recordings) {
            const { data, error } = await supabase.storage
                .from('penProject')
                .createSignedUrl(recording.audio_path, 60 * 60);

            if (error) {
                console.error(
                    `Failed to create URL for recording ${recording.recording_id}:`,
                    error
                );

                recording.audio_url = null;
            } else {
                recording.audio_url = data.signedUrl;
            }
            recording.todos = await getTodos(recording.recording_id);
        }

        res.json({
            success: true,
            recordings
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve recordings'
        });
    }
});


app.get('/', (req, res) => {
	res.send('Hello from the backend server!')
})

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`))

export default app



