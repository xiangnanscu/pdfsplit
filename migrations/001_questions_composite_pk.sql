-- Migration: Change questions table to use composite primary key
-- This allows different exams to have questions with the same ID (e.g., "Q1", "Q2")
-- Run this migration on your D1 database to fix upload conflicts

-- Step 1: Create a new table with the correct schema
CREATE TABLE IF NOT EXISTS questions_new (
    id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    data_url TEXT NOT NULL,
    original_data_url TEXT,
    analysis TEXT,
    PRIMARY KEY (exam_id, id),
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

-- Step 2: Copy data from old table to new table
INSERT INTO questions_new (id, exam_id, page_number, file_name, data_url, original_data_url, analysis)
SELECT id, exam_id, page_number, file_name, data_url, original_data_url, analysis
FROM questions;

-- Step 3: Drop the old table
DROP TABLE questions;

-- Step 4: Rename new table to original name
ALTER TABLE questions_new RENAME TO questions;

-- Step 5: Recreate index
CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);
