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
import { saveRecording, saveTodos, getRecordings ,getTodos, getConversation,saveConversation, saveMessage, getMessages } from "./db.js";
import { createAndStoreEmbeddings } from "./rag/ingest.js";

import { retrieveFromRecording, retrieveFromUser } from "./rag/retriever.js";


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

// async function generateSummaryAndTodos(transcript) {

//     const response = await ai.models.generateContent({
//         model: "gemini-3.6-flash",

//         contents: `
// You are an AI assistant for a smart AI pen. you have given an transcript it can be in any language you had to answer in english only.

// Analyze the following transcript.

// Return:

// 1. A clear and useful description.
// 2. Only the important action items that the user actually needs to do.

// Rules for todos:
// - Only include genuinely important actions.
// - Do not convert general information into a todo.
// - Do not create todos from casual statements.
// - Do not invent tasks.
// - If there are no important actions, return an empty array.
// - Keep each todo short and actionable.

// Transcript:

// ${transcript}
// `,

//         config: {
//             responseMimeType: "application/json",

//             responseSchema: {
//                 type: Type.OBJECT,

//                 properties: {
//                     summary: {
//                         type: Type.STRING
//                     },

//                     todos: {
//                         type: Type.ARRAY,
//                         items: {
//                             type: Type.STRING
//                         }
//                     }
//                 },

//                 required: ["summary", "todos"]
//             }
//         }
//     });

//     return JSON.parse(response.text);
// }

async function generateSummaryAndTodos(transcript) {

    const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",

contents: `
You are an AI assistant for a smart AI pen.

Analyze the conversation transcript and respond in English only.

Return:
1. A detailed set of notes describing the conversation.
2. Only the genuinely important actions the user needs to take.

For the summary:
- Write detailed, well-structured notes, not a short summary.
- Capture the conversation topic, context, key points, discussions, decisions, plans, problems, suggestions, and conclusions.
- Since multiple people may be speaking, distinguish their viewpoints or statements when important.
- Include important names, numbers, dates, deadlines, requirements, and other specific details.
- Preserve important details even if they seem minor, as long as they help understand the conversation.
- Organize related information logically so the notes are easy to review later.
- The notes should allow the user to understand the conversation without listening to the recording.
- Do not copy the transcript word-for-word.
- Do not invent or assume information.

For todos:
- Include only clear, important, actionable tasks.
- Do not create tasks from casual discussion or suggestions unless an actual action is expected.
- Do not invent tasks.
- If there are no important actions, return [].

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


async function answerFromDocuments(question, documents) {

    const context = documents
        .map((doc, index) => {
            return `Document ${index + 1}:
${doc.pageContent}`;
        })
        .join("\n\n");
        console.log("Context for question:", context);

    const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",

        contents: `
    You are an intelligent AI assistant that can answer questions using both the provided conversation context and your general knowledge.

    Your job is to understand the user's intent and decide how to answer.

    IMPORTANT RULES:

    1. QUESTIONS ABOUT THE PROVIDED RECORDING/CONTEXT
    - If the user's question is about something discussed in the provided context, use the context as the primary source.
    - Do not invent or assume information that is not present in the context.
    - If the context contains the answer, answer using the information from the context.
    - You may organize, summarize, explain, compare, or analyze information from the context when requested.

    2. GENERAL KNOWLEDGE QUESTIONS
    - If the user asks a general knowledge question that is not related to the provided context, answer it using your general knowledge.
    - You do NOT need the answer to be present in the context.
    - For example, if the user asks "What is machine learning?", provide a normal, useful explanation even if machine learning is not mentioned in the context.
    - Never respond with "the context does not contain this information" for a general knowledge question.

    3. MIXED QUESTIONS
    - If the question is partly about the context and partly general knowledge, use the relevant information from the context and supplement it with general knowledge.
    - Clearly distinguish between information that comes from the recording and information that is general knowledge when that distinction matters.

    4. ACTIONS ON THE CONTEXT
    The user may ask you to perform operations on the provided context, such as:
    - summarize it
    - explain something
    - extract names, companies, dates, numbers, or topics
    - find specific information
    - compare two things
    - identify decisions
    - identify action items
    - analyze statements
    - answer questions about what a person said
    - find information mentioned in the recording

    When asked to do these things, perform the requested operation using the context.

    5. ACCURACY
    - Never fabricate information about the recording.
    - If a question specifically asks what was said in the recording and the information cannot be found in the context, say that the information was not found in the provided recording context.
    - For general knowledge questions, answer normally using your own knowledge.
    - Do not unnecessarily mention the existence of the context or RAG system.

    6. LANGUAGE
    - Always answer in English unless the user explicitly asks for another language.
    - Give a clear and direct answer.
    - Do not repeat the user's question unnecessarily.

    USER QUESTION:
    ${question}

    PROVIDED CONTEXT:
    ${context}

    Now determine the user's intent and provide the most useful answer.
    `
    });

    return response.text;
}

async function getModifiedQuestion(question, previousMessages) {
    const previousContext = previousMessages
        .map((msg, index) => {
        return `Message ${index + 1} (${msg.role}):
        ${msg.content}`;
        })
        .join("\n\n");  
        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash-lite",
            contents: `
                You are an intelligent AI assistant that can rephrase a user's question to include relevant context from previous messages in a conversation.
                previous messages : 
                ${previousContext}

                User's current question: ${question}

                Your task is to rewrite the user's current question to include relevant context from the previous messages, so that it can be answered accurately without needing to refer back to the previous messages.
                - If the current question is clear and does not require additional context, return it as-is.
                - If the current question is ambiguous or could be better understood with context, rewrite it to include that context.
                - Do not invent any information that is not present in the previous messages or the current question.
                - Keep the rewritten question concise and focused on what the user is asking.
                `
        });

        return response.text;
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
        const { summary, todos } = await generateSummaryAndTodos(transcript);
        console.log('---------------------------------------------------------')
        console.log(summary);
        console.log(todos);

        // insert into database like something thing {{meta things} ,trans , summ , toto} ;
        const recording = await saveRecording({
            user_id: 1, // replace with actual user
            audioPath: data.path,
            title: file.originalname,
            transcript: transcript,
            summary: summary,
            durationSeconds:Math.round(file.size / 1024 / 1024 * 1000 )// approximate duration in seconds
        });

       const todoSaved =  await saveTodos(recording.recording_id, todos);

    //    inserting the imbeddings into the database for the summary and todos and transcription for future search and retrieval
    //    int his i will get recoring id and the todo id
    //    

        const embeddingResult =
        await createAndStoreEmbeddings({
            recordingId: recording.recording_id,
            userId: 1,
            title: file.originalname,
            transcript: transcript
        });
        await createAndStoreEmbeddings({
            recordingId: recording.recording_id,
            userId: 1,
            title: file.originalname,
            transcript: summary
        });

        console.log(
            "Embedding result:",
            embeddingResult
        );
            


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
// not in use mostly
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

app.post('/askRecordingLevel',async (req,res)=>{
    try {
        const { recordingId, question } = req.body;

        const documents = await retrieveFromRecording(recordingId, question);
        // for (const doc of documents) {
        //     console.log(doc.pageContent);
        //     console.log("----------------------------------------------------------------------------------------");
        // }
        const answer = await answerFromDocuments(question , documents);
        console.log("Answer:", answer);
        res.json({
            success: true,
            documents,
            answer
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve documents'
        });
    }

});

app.post('/askUserLevel',async (req,res)=>{
    try {
        const { userId, question } = req.body;

        const documents = await retrieveFromUser(userId, question);

        const answer = await answerFromDocuments(question , documents);

        console.log("Answer:", answer);
        res.json({
            success: true,
            documents,
            answer
        });
        
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve documents'
        });
    }
});

app.post('/askRecordingLevelChat', async(req,res)=>{
    try {
        const { recordingId, userId, question } = req.body; 
        let conversation = await getConversation(userId, recordingId);
        if(!conversation){
           conversation = await saveConversation(userId, recordingId); // save the first question with empty answer
        }
        const conversationId = conversation.conversation_id;

       
        const previousMessages = await getMessages(conversationId);
        previousMessages.reverse();
        const message = await saveMessage(conversationId,question,'user'); 
        const modifiedQuestion = await getModifiedQuestion(question, previousMessages);
        // console.log("Modified Question:", modifiedQuestion);
        // console.log('----------------------------------------------------------');
        const documents = await retrieveFromRecording(recordingId, modifiedQuestion);
        const answer = await answerFromDocuments(modifiedQuestion , documents);
        const answerMessage = await saveMessage(conversationId, answer, 'assistant');
        res.json({
            success: true,
            answer
        });
        
         
    }catch (error) {
        console.error(error);
    }
})


app.post('/getConversationMessages', async(req,res)=>{
    try {
        const { userId, recordingId } = req.body;
        const conversation = await getConversation(userId, recordingId);
        if(!conversation){
            return res.status(404).json({
                success: false,
                message: 'No conversation found for this user and recording'
            });
        }
        else{
            const conversationId = conversation.conversation_id;
            const messages = await getMessages(conversationId);
            res.json({
                success: true,
                messages
            });
        }
    } catch (error) {
        console.error(error);
    }

}) ;

app.post("/getUserLevelConversationMessages", async(req,res)=>{
    try{
        const { conversationId } = req.body;
        const messages = await getMessages(conversationId);
        res.json({
            success: true,
            messages
        });
        
   } catch(error){
    console.error(error);
   }
}) ;

app.post('/askUserLevelChat', async(req,res)=>{
    try{
        const { userId, question, conversationId } = req.body;
        let conversation = await getConversation(userId, null);
        if(!conversation){
            res.status(404).json({
                success: false,
                message: 'No conversation found for this user'
            });
        }
        const previousMessages = await getMessages(conversationId);
        previousMessages.reverse();
        const message = await saveMessage(conversationId,question,'user');
        const modifiedQuestion = await getModifiedQuestion(question, previousMessages);
        console.log("Modified Question:", modifiedQuestion);
        console.log('----------------------------------------------------------');
        const documents = await retrieveFromUser(userId, modifiedQuestion);
        const answer = await answerFromDocuments(modifiedQuestion , documents);
        const answerMessage = await saveMessage(conversationId, answer, 'assistant');
        res.json({
            success: true,
            answer
        });
    }
    catch(error){
        console.error(error);
    }
});






app.post('/createConversation',async(req,res)=>{
    try {
        const { userId } = req.body;
        const conversation = await saveConversation(userId, null);
        res.json({
            success: true,
            conversation
        });
    }catch (error) {
        console.error(error);
    }
}) ;


app.post('/getConversations', async(req,res)=>{
    try {
        const { userId } = req.body;
        let conversation = await getConversation(userId, null);
        console.log("Conversation:", conversation);
        res.json({
            success: true,
            conversation
        }); 
    }
    catch (error) {
        console.error(error);
    }
}) ;






app.get('/', (req, res) => {
	res.send('Hello from the backend server!')
})

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`))

export default app



