import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { vectorStore } from "./vectorStore.js";

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 200
});


export async function createAndStoreEmbeddings({
    recordingId,
    userId,
    title,
    transcript
}) {

    if (!recordingId) {
        throw new Error("recordingId is required");
    }

    if (!userId) {
        throw new Error("userId is required");
    }

    if (!transcript || !transcript.trim()) {
        throw new Error("Transcript is empty");
    }


    console.log(
        `Creating chunks for recording ${recordingId}...`
    );


    // 1. Split transcript into LangChain Documents
    const documents = await splitter.createDocuments(
        [transcript],
        [
            {
                recording_id: recordingId,
                user_id: userId,
                title: title
            }
        ]
    );


    console.log(
        `Created ${documents.length} chunks`
    );


    // Add chunk index
    documents.forEach((doc, index) => {

        doc.metadata.chunk_index = index;

    });


    // 2. LangChain creates embeddings
    // 3. LangChain inserts them into Neon
    console.log(recordingId, "Adding embeddings to vector store...");
    console.log("Documents to be added:", documents.map(doc => doc.metadata));
    await vectorStore.addDocuments(documents);


    console.log(
        `Successfully stored embeddings for recording ${recordingId}`
    );


    return {
        recordingId,
        chunksCreated: documents.length
    };
}