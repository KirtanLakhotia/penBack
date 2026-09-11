import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});


async function saveRecording({
    user_id,
    audioPath,
    title,
    transcript,
    summary,
    durationSeconds
}) {

    const result = await pool.query(
        `
        INSERT INTO recordings
            (
                user_id,
                audio_path,
                title,
                transcript,
                summary,
                duration_seconds
            )
        VALUES
            ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [
            user_id,
            audioPath,
            title,
            transcript,
            summary,
            durationSeconds
        ]
    );

    return result.rows[0];
}

async function saveTodos(recordingId, todos) {
    for (const todo of todos) {
        await pool.query(
            `
            INSERT INTO todos
            (
                recording_id,
                text
            )
            VALUES
            ($1, $2)
            `,
            [
                recordingId,
                todo
            ]
        );
    }
}

async function getRecordings(user_id) {
    const result = await pool.query(
        `
        SELECT * FROM recordings
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [user_id]
    );

    return result.rows;
}

async function getTodos(recordingId) {
    const result = await pool.query(
        `
        SELECT text,is_done FROM todos
        WHERE recording_id = $1
        `,
        [recordingId]
    );

    return result.rows;
}

// async function getConversation(userId, recordingId=null) {
//     const result = await pool.query(
//         `
//         SELECT *
//         FROM conversations
//         WHERE user_id = $1
//           AND recording_id = $2
//         LIMIT 1
//         `,
//         [userId, recordingId]
//     );

//     return result.rows[0] || null;
// }
async function getConversation(userId, recordingId = null) {
    let result;

    if (recordingId === null) {
        result = await pool.query(
            `
            SELECT *
            FROM conversations
            WHERE user_id = $1
            AND recording_id IS NULL
            `,
            [userId]
        );
        return result.rows || null;
    } else {
        result = await pool.query(
            `
            SELECT *
            FROM conversations
            WHERE user_id = $1
              AND recording_id = $2
            LIMIT 1
            `,
            [userId, recordingId]
        );
    }

    return result.rows[0] || null;
}

async function saveConversation(userId, recordingId) {
   const result =  await pool.query(
        `
        INSERT INTO conversations
            (
                user_id,
                recording_id
            )
        VALUES
            ($1, $2)
        RETURNING *
        `,
        [
            userId,
            recordingId
        ]
    );
    return result.rows[0];
}

async function saveMessage(conversationId, question, role) {
    const result = await pool.query(
        `
        INSERT INTO messages
            (
                conversation_id,

                content,
                role
            )
        VALUES
            ($1, $2, $3)
        RETURNING *`,
        [
            conversationId,
            question,
            role
        ]
    );
    return result.rows[0];
}

async function getMessages(conversationId) {
    const result = await pool.query(
        `
        SELECT * FROM messages
        WHERE conversation_id = $1 order by created_at DESC limit 10
        `,
        [conversationId]
    );
    return result.rows;
}

export {
    saveRecording,
    saveTodos,
    getRecordings,
    getTodos,
    getConversation,
    saveConversation,
    saveMessage,
    getMessages
};