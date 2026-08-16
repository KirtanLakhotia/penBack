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

export {
    saveRecording,
    saveTodos,
    getRecordings,
    getTodos
};