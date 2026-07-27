// One-off cleanup:
// 1. Renames the two original seeded past papers to short titles
//    ("Biology Exam 2024" / "Biology Exam 2025").
// 2. The PDF-import feature creates its OWN past_paper row each time
//    it's used (e.g. "NESA 2024-2025 National Exam") — this reassigns
//    any questions tagged under those import rows back to the original
//    seeded paper for the same year, then removes the now-empty
//    duplicate rows, so there's only ever one paper per year and all its
//    imported questions are correctly linked to it.
require('dotenv').config();
const pool = require('../src/config/db');

async function main() {
  const { rows: papers } = await pool.query('SELECT id, title, year FROM past_papers ORDER BY year DESC');
  console.log('Current past_papers:');
  console.table(papers);

  for (const year of [2025, 2024]) {
    const forYear = papers.filter((p) => p.year === year);
    if (forYear.length === 0) {
      console.log(`No past_paper found for ${year}, skipping.`);
      continue;
    }
    // Keep the OLDEST row (the original seed one) as the canonical paper
    // for this year; treat any others (from PDF import) as duplicates.
    const [canonical, ...duplicates] = forYear.sort((a, b) => a.id.localeCompare(b.id));

    await pool.query(`UPDATE past_papers SET title = $1 WHERE id = $2`, [`Biology Exam ${year}`, canonical.id]);
    console.log(`Updated canonical ${year} paper (${canonical.id}) -> title "Biology Exam ${year}"`);

    for (const dup of duplicates) {
      const { rowCount } = await pool.query(
        `UPDATE questions SET past_paper_id = $1 WHERE past_paper_id = $2`,
        [canonical.id, dup.id]
      );
      console.log(`Reassigned ${rowCount} questions from duplicate ${dup.id} -> canonical ${canonical.id}`);
      await pool.query(`DELETE FROM past_papers WHERE id = $1`, [dup.id]);
      console.log(`Deleted duplicate past_paper ${dup.id}`);
    }
  }

  const { rows: after } = await pool.query('SELECT id, title, year FROM past_papers ORDER BY year DESC');
  console.log('\nFinal past_papers:');
  console.table(after);
  await pool.end();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
