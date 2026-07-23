// Seeds a realistic O-Level Biology dataset covering the REB syllabus
// broadly (not just one exam): 7 topics, two real NESA past papers
// (2023-2024 and 2024-2025) with a question bank drawn from both exams'
// Section A plus additional commonly-tested questions, and
// admin/teacher/student accounts for local testing.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [school] } = await client.query(
      `INSERT INTO schools (name, district) VALUES ($1,$2) RETURNING id`,
      ['APACE Secondary School (Groupe Scolaire du Mont Kigali)', 'Nyarugenge']
    );

    const adminHash = await bcrypt.hash('admin123', 10);
    const teacherHash = await bcrypt.hash('teacher123', 10);
    const studentHash = await bcrypt.hash('student123', 10);

    const { rows: [admin] } = await client.query(
      `INSERT INTO users (school_id, role, full_name, email, password_hash)
       VALUES ($1,'admin','Admin User','admin@apace.test',$2) RETURNING id`,
      [school.id, adminHash]
    );

    const { rows: [teacher] } = await client.query(
      `INSERT INTO users (school_id, role, full_name, email, password_hash)
       VALUES ($1,'teacher','Jane Teacher','teacher@apace.test',$2) RETURNING id`,
      [school.id, teacherHash]
    );

    await client.query(
      `INSERT INTO users (school_id, role, full_name, username, password_hash, class_level)
       VALUES ($1,'student','Sample Student','student1',$2,'Senior 3')`,
      [school.id, studentHash]
    );

    const topicRows = [
      ['Cell Biology & Classification', 'Cell theory, organelles, microscopy, classification of living things', 1],
      ['Plant Nutrition & Transport', 'Photosynthesis, xylem/phloem transport, osmosis in plants', 2],
      ['Human Nutrition & Health', 'Nutrients, digestion, skin, blood components, disease prevention', 3],
      ['Human Body Systems', 'Circulatory, respiratory, excretory, nervous and sensory systems', 4],
      ['Genetics', 'DNA, genes, alleles, Punnett squares, blood group inheritance, mitosis vs meiosis', 5],
      ['Reproduction & Health', 'Human and plant reproduction, contraception, STI/HIV prevention, responsible decision-making', 6],
      ['Ecology & Environment', 'Ecosystems, water cycle, population dynamics, human impact, pollution', 7],
    ];
    const topics = {};
    for (const [title, description, order_index] of topicRows) {
      const { rows: [t] } = await client.query(
        `INSERT INTO topics (title, description, order_index) VALUES ($1,$2,$3) RETURNING id, title`,
        [title, description, order_index]
      );
      topics[title] = t.id;
    }

    // ── Real past papers: both NESA national exams ──
    // file_url points at the PDF served from /uploads (see server.js) —
    // tapping this paper in the app now opens the real scanned exam.
    const { rows: [paper2025] } = await client.query(
      `INSERT INTO past_papers (title, year, term, topic_id, file_url, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      ['Biology and Health Sciences I — National Exam (NESA)', 2025, 'National', topics['Cell Biology & Classification'], '/uploads/biology-2024-2025-exam.pdf', teacher.id]
    );
    // No PDF scan uploaded for the 2023-2024 paper yet — file_url stays
    // null (shows as "Not available" in the app, same as an REB paper the
    // backend hasn't been given a scan for). Drop a PDF in /uploads and
    // update file_url to attach it the same way as above.
    const { rows: [paper2024] } = await client.query(
      `INSERT INTO past_papers (title, year, term, topic_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      ['Biology and Health Sciences I — National Exam (NESA)', 2024, 'National', topics['Human Nutrition & Health'], teacher.id]
    );

    const q = (topic, text, options, correct, explanation, difficulty, paperId) => ({
      topic_id: topics[topic], question_text: text, options: JSON.stringify(options),
      correct_answer: correct, explanation, difficulty, past_paper_id: paperId || null,
    });

    const questions = [
      // ---- Cell Biology & Classification ----
      q('Cell Biology & Classification', 'What is the main feature that distinguishes phylum Arthropoda from other animal phyla?',
        { A: 'Radial symmetry', B: 'Exoskeleton made of chitin', C: 'Presence of a backbone', D: 'Bilateral symmetry' }, 'B', null, 2, paper2025.id),
      q('Cell Biology & Classification', 'A microscope has a 10x ocular lens and a 40x objective lens. What is the total magnification?',
        { A: '4x', B: '40x', C: '400x', D: '4000x' }, 'C', 'Total magnification = ocular x objective.', 1, paper2025.id),
      q('Cell Biology & Classification', 'Which organelle is responsible for protein synthesis in both plant and animal cells?',
        { A: 'Golgi apparatus', B: 'Endoplasmic reticulum', C: 'Ribosomes', D: 'Lysosomes' }, 'C', null, 1, paper2025.id),
      q('Cell Biology & Classification', 'Which organelle is known as the powerhouse of the cell?',
        { A: 'Nucleus', B: 'Mitochondria', C: 'Ribosome', D: 'Golgi apparatus' }, 'B', null, 1, null),
      q('Cell Biology & Classification', 'Which structure controls what enters and leaves a cell?',
        { A: 'Cell wall', B: 'Cell membrane', C: 'Nucleus', D: 'Cytoplasm' }, 'B', null, 2, null),
      q('Cell Biology & Classification', 'Which of these best describes what a virus is?',
        { A: 'A microorganism that reproduces independently', B: 'A non-living particle that needs a host cell to replicate', C: 'A type of bacteria that causes infections', D: 'A protozoan parasite that infects humans' }, 'B', null, 2, paper2025.id),
      q('Cell Biology & Classification', 'Which best describes the role of enzymes in biochemical reactions?',
        { A: 'They are consumed and cannot be reused', B: 'They act as catalysts, speeding up reactions without being consumed', C: 'They change the direction of reactions', D: 'They increase the energy required for reactions' }, 'B', null, 2, paper2025.id),
      q('Cell Biology & Classification', 'Which of these is found in plant cells but not animal cells?',
        { A: 'Nucleus', B: 'Cell membrane', C: 'Cell wall', D: 'Mitochondria' }, 'C', null, 2, null),
      q('Cell Biology & Classification', 'Which of these can cause mutations in genetic material?',
        { A: 'Environmental factors such as radiation or chemicals', B: 'Only inheriting genes from parents', C: 'Eating a balanced diet', D: 'Regular exercise' }, 'A', 'Mutations can also arise from copying errors during cell division.', 2, paper2025.id),
      q('Cell Biology & Classification', 'Albinism in humans is best described as',
        { A: 'A vitamin deficiency', B: 'A result of genetic mutation', C: 'An infectious disease', D: 'A learned trait' }, 'B', null, 2, paper2025.id),
      q('Cell Biology & Classification', 'Which of these statements about vertebrate classification is NOT correct?',
        { A: 'Amphibians have scales', B: 'Birds have feathers', C: 'All mammals are vertebrates', D: 'Frogs have moist skin' }, 'A', 'Amphibians have moist skin, not scales — scales are a reptile feature.', 3, paper2024.id),

      // ---- Plant Nutrition & Transport ----
      q('Plant Nutrition & Transport', 'What process do plant cells use to make their own food?',
        { A: 'Respiration', B: 'Photosynthesis', C: 'Digestion', D: 'Excretion' }, 'B', null, 1, null),
      q('Plant Nutrition & Transport', 'Which condition increases the rate of photosynthesis up to a limit, then can decrease it if too extreme?',
        { A: 'Increased light intensity', B: 'Increased temperature', C: 'Reduced water availability', D: 'Decreased light intensity' }, 'B', 'Photosynthetic enzymes work fastest at a mid-range temperature; too high denatures them.', 3, paper2025.id),
      q('Plant Nutrition & Transport', 'Which plant tissue transports water and minerals from roots to the rest of the plant?',
        { A: 'Phloem', B: 'Xylem', C: 'Root hair', D: 'Stomata' }, 'B', null, 2, null),
      q('Plant Nutrition & Transport', 'Which plant tissue transports organic food (sugars) from the leaves to other parts?',
        { A: 'Xylem', B: 'Phloem', C: 'Stomata', D: 'Root hair' }, 'B', null, 2, null),
      q('Plant Nutrition & Transport', 'Which structure absorbs water and minerals from the soil?',
        { A: 'Root hair', B: 'Stomata', C: 'Leaves', D: 'Xylem' }, 'A', null, 1, null),
      q('Plant Nutrition & Transport', 'Osmosis in plants is best described as the movement of',
        { A: 'Solute particles from low to high concentration', B: 'Water across a partially permeable membrane, from high to low water concentration', C: 'Gases in and out of stomata', D: 'Food from leaves to roots' }, 'B', null, 3, paper2025.id),
      q('Plant Nutrition & Transport', 'In an experiment demonstrating osmosis with visking tubing in a beaker, which setup acts as the control?',
        { A: 'Visking tubing with salt solution, in water', B: 'Visking tubing with only water, in water', C: 'Visking tubing with sugar solution, in salt water', D: 'An empty beaker with no tubing' }, 'B', null, 3, paper2024.id),
      q('Plant Nutrition & Transport', 'Why must farmers growing wind-pollinated cereals like wheat, barley, and rice ensure the plants grow close together?',
        { A: 'To allow cross-pollination by wind to occur easily', B: 'To reduce the need for water', C: 'To prevent photosynthesis', D: 'To reduce sunlight exposure' }, 'A', null, 2, null),

      // ---- Human Nutrition & Health ----
      q('Human Nutrition & Health', 'Which nutrient mainly provides energy and helps the body absorb fat-soluble vitamins?',
        { A: 'Proteins', B: 'Fats', C: 'Vitamins', D: 'Minerals' }, 'B', null, 2, paper2025.id),
      q('Human Nutrition & Health', 'Which nutrient mainly supports immune function and cell repair?',
        { A: 'Carbohydrates', B: 'Proteins', C: 'Fats', D: 'Minerals' }, 'B', null, 2, paper2025.id),
      q('Human Nutrition & Health', 'Athletes are usually given glucose rather than sucrose before or during intense exercise. Why?',
        { A: 'Glucose is a simple sugar absorbed and used for energy quickly, without needing digestion first', B: 'Glucose tastes better', C: 'Sucrose is toxic in large amounts', D: 'Glucose contains more calories' }, 'A', null, 3, paper2024.id),
      q('Human Nutrition & Health', 'What is the most basic measure you can take to protect yourself from contracting a disease?',
        { A: 'Practicing good personal hygiene', B: 'Eating only meat', C: 'Avoiding exercise', D: 'Sleeping less' }, 'A', null, 1, paper2024.id),
      q('Human Nutrition & Health', 'Which term describes the removal of undigested food from the body?',
        { A: 'Ingestion', B: 'Digestion', C: 'Absorption', D: 'Egestion' }, 'D', null, 2, paper2025.id),
      q('Human Nutrition & Health', 'Which term describes breaking food down into simpler molecules?',
        { A: 'Ingestion', B: 'Digestion', C: 'Absorption', D: 'Egestion' }, 'B', null, 1, paper2025.id),
      q('Human Nutrition & Health', 'What is the function of the cornified (outer) layer of human skin?',
        { A: 'Temperature regulation through sweating', B: 'Perception of pain and pressure', C: 'Synthesis of Vitamin D', D: 'Prevention of uncontrolled water loss by evaporation' }, 'D', null, 3, paper2024.id),
      q('Human Nutrition & Health', 'Which blood component is primarily responsible for blood clotting?',
        { A: 'White blood cells', B: 'Platelets', C: 'Red blood cells', D: 'Plasma' }, 'B', null, 2, paper2024.id),
      q('Human Nutrition & Health', 'A family that regularly attends community health education programs is more likely to',
        { A: 'Neglect healthy habits in favor of tradition', B: 'Be more aware of health risks and preventive measures', C: 'Avoid healthcare professionals', D: 'Ignore physical exercise' }, 'B', null, 1, paper2025.id),

      // ---- Human Body Systems ----
      q('Human Body Systems', 'Which organ pumps blood around the body?',
        { A: 'Lungs', B: 'Liver', C: 'Heart', D: 'Kidney' }, 'C', null, 1, null),
      q('Human Body Systems', 'What is the primary function of the human circulatory system?',
        { A: 'To circulate air throughout the body', B: 'To transport nutrients, oxygen, and waste products', C: 'To transport hormones and enzymes only', D: 'To protect the body from pathogens' }, 'B', null, 1, paper2025.id),
      q('Human Body Systems', 'Which organs are primarily responsible for filtering waste from the blood?',
        { A: 'Lungs', B: 'Kidneys', C: 'Stomach', D: 'Skin' }, 'B', null, 1, null),
      q('Human Body Systems', 'Which blood cells contain haemoglobin and carry oxygen?',
        { A: 'Lymphocytes', B: 'Phagocytes', C: 'Red blood cells', D: 'Platelets' }, 'C', null, 2, paper2024.id),
      q('Human Body Systems', 'In the absence of oxygen, what process does the body rely on to produce energy during intense exercise?',
        { A: 'Aerobic respiration', B: 'Lactic acid fermentation', C: 'Alcoholic fermentation', D: 'Photosynthesis' }, 'B', null, 2, paper2024.id),
      q('Human Body Systems', 'Which best describes how the skin helps cool the body during excessive heat?',
        { A: 'Vasodilation and sweating', B: 'Vasoconstriction and shivering', C: 'Increased blood flow to internal organs only', D: 'Decreased sweating and increased hair growth' }, 'A', null, 2, paper2025.id),
      q('Human Body Systems', 'Which part of the eye is primarily responsible for detecting light and converting it into nerve impulses?',
        { A: 'Retina', B: 'Lens', C: 'Cornea', D: 'Pupil' }, 'A', null, 2, paper2025.id),
      q('Human Body Systems', 'Which part of the brain controls balance and coordination?',
        { A: 'Cerebrum', B: 'Cerebellum', C: 'Medulla oblongata', D: 'Spinal cord' }, 'B', null, 3, null),
      q('Human Body Systems', "Why is it important for a person to know their own blood group?",
        { A: 'To ensure safe blood transfusion and avoid incompatibility', B: 'To determine eye color', C: 'To predict adult height', D: 'To determine blood pressure' }, 'A', null, 2, paper2024.id),
      q('Human Body Systems', 'Which of these is NOT a function of joints in the human body?',
        { A: 'Enables mobility', B: 'Allows articulation between bones', C: 'Supports the body', D: 'Enables bone growth' }, 'D', 'Joints allow movement; bone growth happens at growth plates, not joints.', 3, paper2024.id),

      // ---- Genetics ----
      q('Genetics', 'What molecule carries genetic information in most organisms?',
        { A: 'RNA', B: 'DNA', C: 'Protein', D: 'Lipid' }, 'B', null, 1, paper2025.id),
      q('Genetics', "An organism's observable characteristics are called its",
        { A: 'Genotype', B: 'Phenotype', C: 'Allele', D: 'Genome' }, 'B', null, 2, paper2025.id),
      q('Genetics', 'A section of DNA that codes for a specific trait is called a',
        { A: 'Chromosome', B: 'Gene', C: 'Allele', D: 'Genome' }, 'B', null, 1, paper2025.id),
      q('Genetics', 'How many chromosomes are found in a normal human body cell?',
        { A: '23', B: '44', C: '46', D: '48' }, 'C', null, 2, paper2025.id),
      q('Genetics', 'A homozygous white-flowered sweet pea is crossed with a homozygous red-flowered one; all offspring have red flowers. Two of these red (Rr) offspring are then crossed together. What fraction of the next generation is expected to have white flowers?',
        { A: '1/4', B: '1/2', C: '3/4', D: '0' }, 'A', 'Rr x Rr gives RR, Rr, Rr, rr — only rr (1 in 4) is white.', 3, paper2025.id),
      q('Genetics', 'In meiosis, crossing over (genetic recombination) mainly occurs during',
        { A: 'Prophase I', B: 'Metaphase II', C: 'Anaphase I', D: 'Telophase II' }, 'A', null, 3, paper2025.id),
      q('Genetics', 'Which correctly contrasts mitosis and meiosis?',
        { A: 'Mitosis produces genetically identical cells; meiosis halves the chromosome number', B: 'Mitosis halves the chromosome number; meiosis produces identical cells', C: 'Both always produce four identical cells', D: 'Both always produce haploid cells' }, 'A', null, 2, paper2025.id),
      q('Genetics', 'A man with blood group A (genotype IAIO) and a woman with blood group B (genotype IBIO) have a child with blood group O. What genotypes are possible among their other children?',
        { A: 'Only AB and OO', B: 'AB, BO, AO, and OO — each with a 25% chance', C: 'Only group A and group B children', D: 'Only IAIB children' }, 'B', 'A Punnett square of IAIO x IBIO gives IAIB, IAIO, IBIO, IOIO in equal proportions.', 3, paper2024.id),
      q('Genetics', 'What are reproductive cells with half the chromosome number of the parent cell, produced by meiosis, called?',
        { A: 'Zygotes', B: 'Gametes', C: 'Somatic cells', D: 'Diploid cells' }, 'B', null, 2, paper2025.id),

      // ---- Reproduction & Health ----
      q('Reproduction & Health', 'Which reproductive organ produces sperm?',
        { A: 'Ovary', B: 'Testis', C: 'Uterus', D: 'Fallopian tube' }, 'B', null, 1, paper2025.id),
      q('Reproduction & Health', 'Where does fertilization normally occur in the human female reproductive system?',
        { A: 'Ovary', B: 'Uterus', C: 'Fallopian tube', D: 'Cervix' }, 'C', null, 2, null),
      q('Reproduction & Health', 'Which of these correctly reduces the risk of transmitting HIV and other STIs?',
        { A: 'Using condoms correctly', B: 'Casual contact such as shaking hands', C: 'Sharing needles for drug use', D: 'Ignoring preventive healthcare programs' }, 'A', null, 1, paper2025.id),
      q('Reproduction & Health', 'Which of these is a common way HIV can be transmitted?',
        { A: 'Shaking hands', B: 'Sharing needles for drug use', C: 'Hugging', D: 'Sharing food' }, 'B', null, 2, paper2025.id),
      q('Reproduction & Health', 'Which contraceptive method is classified as a barrier method?',
        { A: 'Pills', B: 'Implant', C: 'Condom', D: 'IUD' }, 'C', null, 2, paper2024.id),
      q('Reproduction & Health', 'Why does a pregnant woman need more iron in her diet than a man of the same age?',
        { A: 'To form more haemoglobin and red blood cells for herself and the developing fetus', B: 'To help with digestion', C: 'To increase muscle mass', D: 'To improve eyesight' }, 'A', null, 2, paper2024.id),
      q('Reproduction & Health', 'What does fertilization in flowering plants result in?',
        { A: 'A zygote, which develops into a seed', B: 'A pollen grain', C: 'A stigma', D: 'A petal' }, 'A', null, 2, paper2025.id),
      q('Reproduction & Health', "Which factor should most responsibly guide a young adult's decision about starting a sexual relationship?",
        { A: 'The level of sexual experience each partner has', B: 'The long-term emotional and physical consequences of the relationship', C: 'Whether the relationship is romantic or purely physical', D: 'The availability of birth control alone' }, 'B', null, 2, paper2025.id),
      q('Reproduction & Health', 'If someone experiences sexual assault, what is an appropriate first step?',
        { A: 'Stay silent to avoid embarrassment', B: 'Report to a trusted adult, the authorities, or seek help at a health center', C: 'Blame themselves for what happened', D: 'Avoid seeking medical help' }, 'B', "Rwanda's Isange One Stop Centers provide free medical, legal, and counseling support for survivors.", 2, paper2024.id),

      // ---- Ecology & Environment ----
      q('Ecology & Environment', 'How does the water cycle mainly contribute to sustaining ecosystems?',
        { A: 'It increases the salinity of water bodies', B: 'It ensures water is continuously available to plants, animals, and humans', C: 'It stops evaporation of water', D: 'It prevents contamination of water sources' }, 'B', null, 1, paper2025.id),
      q('Ecology & Environment', 'Which human activity is most directly linked to habitat destruction?',
        { A: 'Overfishing', B: 'Recycling', C: 'Deforestation', D: 'Sustainable agriculture' }, 'C', null, 1, paper2025.id),
      q('Ecology & Environment', 'How does migration into an area typically affect the local population growth rate?',
        { A: 'It decreases it', B: 'It increases it by introducing new individuals', C: 'It has no effect', D: 'It always causes extinction' }, 'B', null, 2, paper2025.id),
      q('Ecology & Environment', "Predation mainly regulates prey populations by removing individuals through hunting — why doesn't this reasoning apply to scavengers?",
        { A: "Scavengers feed on animals that are already dead, so they don't directly reduce the living prey population", B: 'Scavengers only eat plants', C: 'Scavengers have no effect on any population', D: 'Scavengers hunt healthier prey than predators do' }, 'A', null, 3, null),
      q('Ecology & Environment', 'Why is monoculture farming (growing a single crop species over a large area) considered harmful to biodiversity?',
        { A: 'It increases genetic variability in crops', B: 'It reduces genetic variability, making crops more vulnerable to pests and disease', C: 'It always improves soil quality', D: 'It has no impact on ecosystems' }, 'B', null, 3, paper2024.id),
      q('Ecology & Environment', 'Why should industrial plants treat their wastewater before releasing it into rivers or lakes?',
        { A: 'To prevent water pollution and protect aquatic life', B: 'To make the water taste better', C: 'To increase water temperature', D: 'To increase fish population directly' }, 'A', null, 1, paper2024.id),
    ];

    for (const qq of questions) {
      await client.query(
        `INSERT INTO questions (topic_id, past_paper_id, question_text, question_type, options, correct_answer, explanation, difficulty, created_by)
         VALUES ($1,$2,$3,'mcq',$4,$5,$6,$7,$8)`,
        [qq.topic_id, qq.past_paper_id, qq.question_text, qq.options, qq.correct_answer, qq.explanation, qq.difficulty, teacher.id]
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log(`  Topics: ${Object.keys(topics).length}, Questions: ${questions.length}`);
    console.log('  Admin login:   admin@apace.test / admin123');
    console.log('  Teacher login: teacher@apace.test / teacher123');
    console.log('  Student login: student1 / student123');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
