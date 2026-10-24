import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ol } from "../data/student-knowledge/ol.mjs";
import { al } from "../data/student-knowledge/al.mjs";
import { general } from "../data/student-knowledge/general.mjs";
import { sources, sourceIdsFor } from "../data/student-knowledge/sources.mjs";
const root = new URL("../public/student-knowledge/", import.meta.url);
await mkdir(new URL("md/", root), { recursive: true });
const sourceMap = new Map(sources.map((s) => [s.id, s]));
const packs = [];
for (const [level, entries] of [
  ["OL", ol],
  ["AL", al],
  ["GENERAL", general],
]) {
  for (const [slug, title, subjects, aliases, qa] of entries) {
    const id = `${level.toLowerCase()}-${slug}`;
    const refs = sourceIdsFor(level, slug);
    if (!refs?.length || refs.some((id) => !sourceMap.has(id)))
      throw Error(`Missing references: ${id}`);
    const methodsOnly =
      /sinhala|tamil|english|languages|literature|aesthetics|religion|history/.test(
        slug,
      );
    const pack = {
      id,
      number: packs.length + 1,
      level,
      title,
      subjects,
      aliases,
      language: "en",
      titleSearchLanguages: ["en", "si", "ta"],
      depth: methodsOnly
        ? "foundations and study methods"
        : "introductory foundations",
      scope:
        "Selected foundation concepts and original practice. Not a complete syllabus or official marking scheme.",
      syllabusAlignment:
        "Topic-level reference only; exam-year and competency-by-competency mapping require teacher review.",
      reviewStatus:
        "Original editorial content; subject-teacher review pending.",
      sourceIds: refs,
      sourceCheckedAt: "2026-10-24",
      license:
        "Original Orin editorial notes; linked third-party works retain their own rights.",
      markdownUrl: `/student-knowledge/md/${id}.md`,
      records: qa.map(([question, answer], i) => ({
        id: `${id}-${String(i + 1).padStart(3, "0")}`,
        datasetId: id,
        level,
        subjects,
        language: "en",
        question,
        answer,
        difficulty: "foundation",
        origin:
          "original instructional example; not an official past-paper question",
        reviewStatus: "teacher-review-pending",
        sourceIds: refs,
        sourceRole:
          level === "GENERAL"
            ? "official service references plus original guidance"
            : "curriculum/resource locators, not official answer-key provenance",
        sourceCheckedAt: "2026-10-24",
      })),
    };
    const markdown =
      `# ${level === "GENERAL" ? "Sri Lanka student guide" : level.replace("L", "/L")} — ${title}\n\n` +
      `Dataset: ${id}\nLanguage: English. Subject-search aliases: ${aliases}\nCoverage: ${pack.scope}\nAlignment: ${pack.syllabusAlignment}\nReview: ${pack.reviewStatus}\nSource checks: 2026-10-24. Original exercises are not official examination questions.\n\n` +
      pack.records
        .map(
          (r) =>
            `## ${level} ${title}: ${r.question}\n\n${r.answer}\n\nRecord: ${r.id}. Original foundation note; teacher review pending.\n`,
        )
        .join("\n") +
      `\n## References and source-access limits\n\n` +
      refs
        .map((id) => {
          const s = sourceMap.get(id);
          return `- [${s.title}](${s.url}) — ${s.role}. Access: ${s.access}.${s.edition ? " Edition note: " + s.edition + "." : ""}`;
        })
        .join("\n") +
      `\n\nThese links are references, not a statement that the authority authored or endorsed these answers. No complete textbooks, past papers or marking schemes are reproduced. Verify the examination year, medium, prescribed texts and current notices.\n\n## Reuse\n\nOriginal editorial text: Orin Student Knowledge, foundation release 2026-10-24. Links do not grant reuse rights to third-party source material.\n`;
    pack.sha256 = createHash("sha256").update(markdown).digest("hex");
    pack.bytes = Buffer.byteLength(markdown);
    await writeFile(new URL(`md/${id}.md`, root), markdown);
    packs.push(pack);
  }
}
if (ol.length !== 20 || al.length !== 30 || packs.length !== 58)
  throw Error("Expected 50 academic and 8 practical packs");
const records = packs.flatMap((p) => p.records);
if (
  records.length !== 332 ||
  new Set(records.map((r) => r.id)).size !== records.length
)
  throw Error("Invalid record count or duplicate IDs");
const manifest = {
  schemaVersion: 1,
  release: "2026-10-24-foundations",
  createdAt: "2026-10-24",
  title: "Orin Student Knowledge — Sri Lankan O/L and A/L foundations",
  description:
    "50 academic foundation packs and 8 Sri Lanka student-service guides; English notes with Sinhala/Tamil subject-search aliases.",
  academicPacks: 50,
  practicalPacks: 8,
  totalPacks: 58,
  totalRecords: records.length,
  reviewStatus:
    "Subject-teacher review pending. Not complete curricula; not official past papers or marking schemes.",
  coverageNote:
    "Core subjects are split by topic; related electives are grouped. A subject name in a group does not imply complete subject coverage. Language and aesthetic packs mainly teach study and analysis methods.",
  accessNote:
    "Source-access status is recorded individually. Some references were verified only through search metadata; blocked and oversized documents were not fully read or ingested.",
  translations:
    "Full Sinhala and Tamil answer translations are not included. Search aliases are provided; official resources offer medium-specific material.",
  liveInformation:
    "Do not use stored data as a current timetable, fee, cutoff, deadline, eligibility ruling, political-office list or emergency warning.",
  license:
    "Original Orin editorial content; third-party references retain their own rights.",
  sources,
  datasets: packs,
};
await writeFile(
  new URL("catalog.json", root),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  new URL("records.jsonl", root),
  records.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
await writeFile(
  new URL("manifest.json", root),
  JSON.stringify(
    {
      ...manifest,
      datasets: packs.map(({ records, ...p }) => ({
        ...p,
        recordCount: records.length,
      })),
    },
    null,
    2,
  ) + "\n",
);
const readme =
  `# Orin Student Knowledge\n\n50 academic foundation datasets (20 O/L, 30 A/L), plus 8 practical Sri Lanka student guides. Total: 332 original Q&A records.\n\n${manifest.reviewStatus}\n\n${manifest.coverageNote}\n\n${manifest.accessNote}\n\n${manifest.translations}\n\n${manifest.liveInformation}\n\n## Files\n\n- md/: one RAG-ready Markdown file per dataset.\n- records.jsonl: one structured Q&A record per line.\n- catalog.json: records, subject-search aliases, source access and coverage metadata.\n- manifest.json: file checksums, counts and source registry.\n\n## Academic datasets\n\n| # | Level | Dataset | Records |\n|---|---|---|---|\n` +
  packs
    .filter((p) => p.level !== "GENERAL")
    .map(
      (p) =>
        `| ${p.number} | ${p.level} | [${p.title}](md/${p.id}.md) | ${p.records.length} |`,
    )
    .join("\n") +
  `\n\n## Practical Sri Lanka guides\n\n` +
  packs
    .filter((p) => p.level === "GENERAL")
    .map((p) => `- [${p.title}](md/${p.id}.md)`)
    .join("\n") +
  `\n\n## Sources and rights\n\nOfficial sources were researched on 2026-10-24. Curriculum links establish subject orientation; original worked examples and answers are editorial content, not government-authored answer keys. See each source's access and edition notes.\n\nThese are original Orin notes and exercises. Linked third-party textbooks, papers and other works retain their own rights and are not relicensed by this dataset.\n\n## RAG import\n\nRun npm run knowledge:import for a dry run. npm run knowledge:import -- --apply adds or updates drafts in the configured Neon database. It does not publish automatically or call embedding providers. Review the material, then index and publish through Administration.\n`;
await writeFile(new URL("README.md", root), readme);
execFileSync(
  "python3",
  [
    "-c",
    `from pathlib import Path\nfrom zipfile import ZipFile,ZipInfo,ZIP_DEFLATED\np=Path('public/student-knowledge')\nwith ZipFile(p/'orin-student-knowledge.zip','w',ZIP_DEFLATED) as z:\n for f in sorted(p.rglob('*')):\n  if f.is_file() and f.suffix!='.zip':\n   info=ZipInfo(str(f.relative_to(p)),(2026,10,24,0,0,0))\n   info.compress_type=ZIP_DEFLATED\n   info.external_attr=0o100644<<16\n   z.writestr(info,f.read_bytes())\n`,
  ],
  { cwd: new URL("../", import.meta.url) },
);
console.log(
  JSON.stringify({
    academicPacks: 50,
    practicalPacks: 8,
    records: records.length,
    output: root.pathname,
  }),
);
