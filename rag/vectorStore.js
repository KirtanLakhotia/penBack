import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { embeddings } from "./embeddings.js";

export const vectorStore =
    await PGVectorStore.initialize(
        embeddings,
        {
            postgresConnectionOptions: {
                connectionString: process.env.DATABASE_URL
            },

            tableName: "recording_chunks",

            columns: {
                idColumnName: "chunk_id",
                vectorColumnName: "embedding",
                contentColumnName: "chunk_text",
                metadataColumnName: "metadata"
            }
        }
    );