// Bulk-imports questions from a CSV file into the `questions` table.
//
// Usage:
//   node --dns-result-order=ipv6first db/import_questions.js db/questions_template.csv
//
// CSV columns (header row required, exact names):
//   topic,question,option_a,option_b,option_c,option_d,correct_letter,explanation,difficulty,paper_year
//
// - topic         must exactly match an existing topic title (see db/seed.js topicRows)
// - correct_letter is one of A/B/C/D
// - difficulty    is 1 (easy), 2 (medium), or 3 (hard)
// - paper_year    optional — if it matches an existing past_paper's year, the
//                 question is linked to that paper; leave blank otherwise
//
// Safe to run repeatedly: each run only ADDS the rows in the CSV, it never
// deletes or overwrites existing questions.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

function parseCsv(text) {
  // Minimal CSV parser: handles quoted fields containing commas, but not
  // embedded newlines inside quotes — keep each question on one line.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row = {};
    header.forEach((key, i) => { row[key.trim()] = (cells[i] || '').trim(); });
    return row;
  });
}

function splitLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node db/import_questions.js <path-to-csv>');
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(path.resolve(csvPath), 'utf8'));

  const { rows: topicRows } = await pool.query('SELECT id, title FROM topics');
  const topicByTitle = Object.fromEntries(topicRows.map((t) => [t.title.trim().toLowerCase(), t.id]));

  const { rows: paperRows } = await pool.query('SELECT id, year FROM past_papers');
  const paperByYear = Object.fromEntries(paperRows.map((p) => [String(p.year), p.id]));

  let inserted = 0;
  let skipped = 0;
  let alreadyPresent = 0;

  // Each row is its own independent statement (no wrapping BEGIN/COMMIT) —
  // on this network, a single long transaction holding 70+ inserts risks
  // the connection dropping partway through and losing everything. This
  // way a mid-run failure only costs the remaining rows, and since we
  // check for an existing identical question first, simply re-running the
  // same command afterward safely picks up where it left off.
  for (const [i, row] of rows.entries()) {
    const topicId = topicByTitle[(row.topic || '').trim().toLowerCase()];
    if (!topicId) {
      console.warn(`Row ${i + 2}: skipped — topic "${row.topic}" not found`);
      skipped++;
      continue;
    }
    const letter = (row.correct_letter || '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(letter)) {
      console.warn(`Row ${i + 2}: skipped — correct_letter must be A/B/C/D, got "${row.correct_letter}"`);
      skipped++;
      continue;
    }

    try {
      const { rows: existing } = await pool.query(
        `SELECT id FROM questions WHERE topic_id = $1 AND question_text = $2 LIMIT 1`,
        [topicId, row.question]
      );
      if (existing.length) {
        alreadyPresent++;
        continue;
      }

      const options = { A: row.option_a, B: row.option_b, C: row.option_c, D: row.option_d };
      const pastPaperId = row.paper_year ? paperByYear[row.paper_year.trim()] || null : null;

      await pool.query(
        `INSERT INTO questions (topic_id, past_paper_id, question_text, question_type, options, correct_answer, explanation, difficulty, created_by)
         VALUES ($1,$2,$3,'mcq',$4,$5,$6,$7,NULL)`,
        [topicId, pastPaperId, row.question, JSON.stringify(options), letter,
         row.explanation || null, parseInt(row.difficulty, 10) || 2]
      );
      inserted++;
      console.log(`Row ${i + 2}: inserted (${inserted} so far)`);
    } catch (err) {
      console.error(`Row ${i + 2}: FAILED — ${err.message}`);
      console.error(`Stopped after ${inserted} inserted, ${alreadyPresent} already present. Re-run the same command to continue from here — already-inserted rows will be skipped automatically.`);
      await pool.end();
      process.exit(1);
    }
  }

  console.log(`Import complete: ${inserted} inserted, ${alreadyPresent} already present, ${skipped} skipped.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
