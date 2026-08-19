// Precision/Recall/MRR benchmark for /api/search against the 10 ground-truth
// keywords established in the post-migration audit (text-embedding-3-large,
// halfvec(3072) + hnsw). Ground truth is fixed data, not re-derived here.
//
// Run: node scripts/benchmark-retrieval.mjs
// Requires the dev server running at http://localhost:3000.

const SEARCH_URL = "http://localhost:3000/api/search";

// Ground truth from the Step 1 audit. Each keyword's relevant set is the
// *topical* relevance set reported there (a superset of literal phrase
// matches where the two differ) unless noted otherwise.
const GROUND_TRUTH = [
  {
    keyword: "ESG",
    relevant: [
      "Aegean_Resorts_ESG_Workshop_Transcript.txt",
      "Aegean_Resorts_Hospitality_ESG_Strategy.pptx",
      "Bloomberg_Intelligence__2024.pdf",
      "ESG_Reporting_Software_Competitor_Analysis.xlsx",
      "KPMG_-cyprus-hospitality-newsletter-february-2023-issue.pdf",
      "Meridian_Textiles_ESG_Gap_Assessment.docx",
      "Meridian_Textiles_Kickoff_Call_Transcript.txt",
      "Meridian_Textiles_Site_Sustainability_Audit_Summary.pdf",
      "sample_scan_meridian_compliance_memo.jpg",
      "sample_scanned_only_test.pdf",
      "SEBI_BRSR_Core_mandates_2023.pdf",
      "SEBI_BRSR_mandates.pdf",
    ],
  },
  {
    keyword: "RevPAR",
    relevant: ["India_Hospitality_Market_Report.pdf"],
  },
  {
    keyword: "compliance framework",
    relevant: [
      "Meridian_Textiles_ESG_Gap_Assessment.docx",
      "ESG_Reporting_Software_Competitor_Analysis.xlsx",
      "SEBI_BRSR_Core_mandates_2023.pdf",
      "SEBI_BRSR_mandates.pdf",
      "echa_europa_eu_regulations_reach_understanding_reach.pdf",
    ],
  },
  {
    keyword: "financial statement",
    relevant: ["Gulf_Horizon_Hospitality_Quarterly_Financial_Summary.pdf"],
  },
  {
    keyword: "RACI",
    relevant: ["ProdZen_Client_Onboarding_Framework.docx"],
  },
  {
    keyword: "Watershed",
    relevant: ["ESG_Reporting_Software_Competitor_Analysis.xlsx", "Meridian_Textiles_ESG_Gap_Assessment.docx"],
  },
  {
    keyword: "cotton irrigation",
    relevant: ["International_Cotton_Advisory_Committee.pdf", "Meridian_Textiles_Site_Sustainability_Audit_Summary.pdf"],
  },
  {
    keyword: "meeting transcript",
    relevant: ["Aegean_Resorts_ESG_Workshop_Transcript.txt", "Meridian_Textiles_Kickoff_Call_Transcript.txt"],
  },
  {
    // Special case: dual ground truth. `relevant` (used for the standard
    // precision/P@5/RR columns) is the content-based set — the only
    // document whose body text actually contains "Gulf Horizon". `relevantTrue`
    // is the full client-associated set, used only for the second recall figure.
    keyword: "Gulf Horizon",
    relevant: ["Gulf_Horizon_Hospitality_Quarterly_Financial_Summary.pdf"],
    relevantTrue: [
      "Gulf_Horizon_Hospitality_Quarterly_Financial_Summary.pdf",
      "Gulf_Horizon_UAE_Market_Entry_Strategy.pptx",
      "UAE_Hospitality_Market_Report.pdf",
    ],
  },
  {
    // Negative control: nothing in the corpus should match.
    keyword: "UAE real estate",
    relevant: [],
  },
];

function precisionRecall(returnedTitles, relevantSet) {
  const returned = returnedTitles;
  const relevant = new Set(relevantSet);
  const hits = returned.filter((t) => relevant.has(t));

  const precision = returned.length ? hits.length / returned.length : relevant.size === 0 ? null : 0;
  const recall = relevant.size ? hits.length / relevant.size : null; // null = undefined (negative control)

  const top5 = returned.slice(0, 5);
  const hits5 = top5.filter((t) => relevant.has(t));
  const precisionAt5 = top5.length ? hits5.length / top5.length : relevant.size === 0 ? null : 0;

  let reciprocalRank = 0;
  for (let i = 0; i < returned.length; i++) {
    if (relevant.has(returned[i])) {
      reciprocalRank = 1 / (i + 1);
      break;
    }
  }

  return { precision, recall, precisionAt5, reciprocalRank, hits: hits.length, returnedCount: returned.length };
}

async function runSearch(keyword) {
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: keyword }),
  });
  if (!res.ok) {
    throw new Error(`/api/search failed for "${keyword}": ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const results = [];

for (const { keyword, relevant, relevantTrue } of GROUND_TRUTH) {
  const raw = await runSearch(keyword);
  const ranked = raw.map((r) => ({ title: r.title, similarity: r.similarity }));
  const titles = ranked.map((r) => r.title);

  const metrics = precisionRecall(titles, relevant);
  let trueRecall = null;
  if (relevantTrue) {
    const relevantTrueSet = new Set(relevantTrue);
    const hitsTrue = titles.filter((t) => relevantTrueSet.has(t));
    trueRecall = relevantTrue.length ? hitsTrue.length / relevantTrue.length : null;
  }

  results.push({ keyword, ranked, relevant, relevantTrue, metrics, trueRecall });
}

// ---- Report ----
console.log("=== Raw ranked results per keyword ===\n");
for (const r of results) {
  console.log(`--- "${r.keyword}" (${r.ranked.length} returned) ---`);
  if (r.ranked.length === 0) console.log("  (no results)");
  r.ranked.forEach((item, i) => {
    const isRelevant = r.relevant.includes(item.title);
    console.log(`  ${i + 1}. [${isRelevant ? "RELEVANT" : "        "}] ${item.title} (sim=${item.similarity?.toFixed(4)})`);
  });
  console.log("");
}

console.log("\n=== Metrics table ===\n");
const header = ["keyword", "precision", "recall", "precision@5", "reciprocal_rank", "notes"];
console.log(header.join(" | "));
console.log(header.map(() => "---").join(" | "));

const fmt = (v) => (v === null ? "N/A" : v.toFixed(3));

for (const r of results) {
  const { precision, recall, precisionAt5, reciprocalRank, hits, returnedCount } = r.metrics;
  let notes = `${hits}/${r.relevant.length} relevant docs returned, ${returnedCount} total returned`;
  if (r.keyword === "Gulf Horizon") {
    notes += `; true-relevance recall (3-doc client set) = ${fmt(r.trueRecall)}`;
  }
  if (r.keyword === "UAE real estate") {
    notes = returnedCount === 0 ? "correctly returned 0 results (negative control)" : `returned ${returnedCount} results despite 0 ground-truth matches`;
  }
  console.log([r.keyword, fmt(precision), fmt(recall), fmt(precisionAt5), fmt(reciprocalRank), notes].join(" | "));
}

const mrrEligible = results.filter((r) => r.keyword !== "UAE real estate"); // RR undefined-by-design for the negative control's non-metric
const mrr = mrrEligible.reduce((sum, r) => sum + r.metrics.reciprocalRank, 0) / mrrEligible.length;
console.log(`\nMRR (mean reciprocal rank across all 10 keywords, treating the negative control's RR as 0 since it has no relevant doc to rank): ${(
  results.reduce((sum, r) => sum + r.metrics.reciprocalRank, 0) / results.length
).toFixed(3)}`);
console.log(`MRR excluding the negative control (9 keywords with a real answer to rank): ${mrr.toFixed(3)}`);

const worst = [...results].filter(r => r.keyword !== "UAE real estate").sort((a, b) => (a.metrics.recall ?? 0) - (b.metrics.recall ?? 0));
console.log("\n=== Worst 3 by recall ===");
worst.slice(0, 3).forEach((r) => console.log(`  ${r.keyword}: recall=${fmt(r.metrics.recall)}, precision=${fmt(r.metrics.precision)}`));

const financialStatementResult = results.find((r) => r.keyword === "financial statement");
const foundGulfFinancial = financialStatementResult.ranked.some((r) => r.title === "Gulf_Horizon_Hospitality_Quarterly_Financial_Summary.pdf");
console.log(`\n"financial statement" semantic-matching litmus test: Gulf_Horizon_Hospitality_Quarterly_Financial_Summary.pdf ${foundGulfFinancial ? "WAS" : "was NOT"} found despite zero literal phrase match in its body text.`);
