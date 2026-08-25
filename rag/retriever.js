import { vectorStore } from "./vectorStore.js";


export async function retrieveFromRecording(
    recordingId,
    question
) {

    const retriever = vectorStore.asRetriever({
        k: 3,

        filter: {
            recording_id : String(recordingId)
        }
    });


    const documents =
        await retriever.invoke(question);


    return documents;
}


export async function retrieveFromUser(
    userId,
    question
) {

    const retriever = vectorStore.asRetriever({
        k: 5,

        filter: {
            user_id: userId
        }
    });


    const documents =
        await retriever.invoke(question);


    return documents;
}