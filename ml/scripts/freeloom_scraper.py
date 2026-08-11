"""
Bulk-fetches real academic/research citations from two free, public,
unauthenticated APIs -- ERIC (U.S. Dept of Education's education-research
index) and Crossref (scholarly metadata across publishers) -- searching
each for a fixed list of alternative-education/pedagogy terms (unschooling,
forest school, ADHD self-directed learning, game-based learning, etc.) and
compiling the results into one deduplicated spreadsheet.

Built to avoid spending LLM tokens on this kind of bulk, mechanical
data-gathering -- these are open, structured APIs, not sites that need an
LLM to interpret; a plain HTTP client is the right tool for "pull 5,000
citations matching these search terms," same reasoning as why
prepare_base_corpus.py pulls TinyStories/FineWeb-Edu directly rather than
generating that volume of text with a model.

Each row buckets into a *guessed* Primary/Secondary subject via a simple
keyword heuristic (infer_subjects() below) -- a first-pass label, not a
verified one; same "good enough starting point, human/pipeline reviews it
later" spirit as this project's other heuristic classifiers
(src/lib/pipeline/classify.ts's cluster matching, this repo's
knowledgeBase.ts). Output is NOT loaded directly into the app's
`knowledge_base` table by this script -- see the accompanying conversion
tooling for that step, since this data's shape (research citations
*about* a pedagogy, not activities a kid actually did) needs a different
treatment than the course-database spreadsheet's knowledge_base import did.

Usage:
    pip install requests pandas openpyxl
    python3 freeloom_scraper.py
    # writes freeloom_academic_database.csv and .xlsx to the current directory
"""

import os
import re
import time
import urllib.parse
import requests
import pandas as pd

# CONFIGURATION
EMAIL = "freeloom_researcher@example.com"
OUTPUT_EXCEL = "freeloom_academic_database.xlsx"
OUTPUT_CSV = "freeloom_academic_database.csv"

# SEARCH QUERIES
QUERIES = [
    # Unschooling & Self-Directed
    {"term": "unschooling", "category": "Core Pedagogy"},
    {"term": "self-directed education", "category": "Core Pedagogy"},
    {"term": "child-led learning", "category": "Core Pedagogy"},
    {"term": "democratic school", "category": "Core Pedagogy"},
    {"term": "autonomous learning", "category": "Core Pedagogy"},
    {"term": "sudbury education", "category": "Core Pedagogy"},
    {"term": "homeschooling outcomes", "category": "Core Pedagogy"},

    # Wildschooling & Nature-Based
    {"term": "wildschooling", "category": "Wildschooling & Nature-Based"},
    {"term": "forest school", "category": "Wildschooling & Nature-Based"},
    {"term": "outdoor learning pedagogy", "category": "Wildschooling & Nature-Based"},
    {"term": "place-based education", "category": "Wildschooling & Nature-Based"},
    {"term": "risky play outdoor", "category": "Wildschooling & Nature-Based"},
    {"term": "nature-based learning", "category": "Wildschooling & Nature-Based"},

    # Deschooling & Support
    {"term": "deschooling", "category": "Neurodivergent & Support"},
    {"term": "school refusal anxiety", "category": "Neurodivergent & Support"},
    {"term": "autism homeschooling", "category": "Neurodivergent & Support"},
    {"term": "adhd self-directed", "category": "Neurodivergent & Support"},
    {"term": "school burnout recovery", "category": "Neurodivergent & Support"},

    # Digital & Interest-Based
    {"term": "game-based learning minecraft", "category": "Digital & Game-Based"},
    {"term": "informal gaming literacy", "category": "Digital & Game-Based"},
    {"term": "interest-led learning", "category": "Electives & Interest-Based"},
    {"term": "passion-driven education", "category": "Electives & Interest-Based"},
    {"term": "self-determination theory learning", "category": "Electives & Interest-Based"}
]

def clean_html(raw_html):
    if not raw_html:
        return ""
    clean_text = re.sub('<.*?>', '', str(raw_html))
    return clean_text.strip()[:350]

def infer_subjects(text_blob):
    text = text_blob.lower()
    if any(k in text for k in ["forest", "outdoor", "nature", "wildschooling", "environment", "botany", "plant"]):
        return "Science", "Physical Education & Health"
    elif any(k in text for k in ["game", "digital", "minecraft", "technology", "coding", "computer"]):
        return "Computer Science & Technology", "Mathematics"
    elif any(k in text for k in ["anxiety", "refusal", "autonomy", "mental health", "emotion", "well-being", "adhd", "autism"]):
        return "Social-Emotional Development", "Business & Life Skills"
    elif any(k in text for k in ["literacy", "reading", "writing", "storytelling", "narrative"]):
        return "English/Language Arts", "Social Studies"
    elif any(k in text for k in ["civic", "democratic", "history", "community", "society"]):
        return "Social Studies", "Social-Emotional Development"
    else:
        return "Social Studies", "Interdisciplinary Studies"

def fetch_eric_records():
    print("=== [1/2] Querying ERIC API (U.S. Dept of Education) ===")
    records = []
    headers = {"User-Agent": f"FreeLoomResearch/1.0 ({EMAIL})"}

    for item in QUERIES:
        query = item["term"]
        cat = item["category"]
        print(f"  [+] ERIC query: '{query}'...")

        url = f"https://api.eric.ed.gov/api/search?kw={urllib.parse.quote(query)}&format=json&rows=200"

        try:
            res = requests.get(url, headers=headers, timeout=15)
            if res.status_code == 200:
                docs = res.json().get("response", {}).get("docs", [])
                for doc in docs:
                    title = doc.get("title")
                    abstract = clean_html(doc.get("description", ""))
                    eric_id = doc.get("id")
                    source = doc.get("source", "ERIC Database")
                    pub_year = doc.get("publicationdateyear", "")
                    subjects = doc.get("subject", [])

                    if not title:
                        continue

                    kw_str = ", ".join(subjects[:5]) if isinstance(subjects, list) else query
                    full_text = f"{title} {abstract} {kw_str}"
                    p_subj, s_subj = infer_subjects(full_text)

                    records.append({
                        "Activity / Methodology": title,
                        "Category": cat,
                        "Suggested Course Title": f"Applied Alternative Education Inquiry ({query.title()})",
                        "Primary Subject": p_subj,
                        "Secondary Subject": s_subj,
                        "Description / Educational Rationale": abstract if abstract else f"ERIC study examining {query}.",
                        "Classification Keywords": kw_str,
                        "Scientific Backing (Source)": f"{source} ({pub_year})",
                        "Evidence Level": "ERIC Educational Record",
                        "DOI / URL": f"https://eric.ed.gov/?id={eric_id}"
                    })
            time.sleep(0.2)
        except Exception as e:
            print(f"    [-] ERIC error on '{query}': {e}")

    print(f"  [✔] ERIC total extracted: {len(records)} records.")
    return records

def fetch_crossref_records():
    print("\n=== [2/2] Querying Crossref Academic API ===")
    records = []
    headers = {"User-Agent": f"FreeLoomScraper/1.0 (mailto:{EMAIL})"}

    for item in QUERIES:
        query = item["term"]
        cat = item["category"]
        print(f"  [+] Crossref query: '{query}'...")

        for offset in [0, 100, 200]:  # Fetch up to 300 results per query term
            url = f"https://api.crossref.org/works?query={urllib.parse.quote(query)}&rows=100&offset={offset}"
            try:
                res = requests.get(url, headers=headers, timeout=15)
                if res.status_code == 200:
                    items = res.json().get("message", {}).get("items", [])
                    if not items:
                        break

                    for doc in items:
                        title_list = doc.get("title", [])
                        title = title_list[0] if title_list else ""
                        doi = doc.get("DOI")
                        container = doc.get("container-title", [])
                        journal = container[0] if container else "Peer-Reviewed Publication"

                        # Year extraction
                        date_parts = doc.get("published-print", {}).get("date-parts", [[]])[0]
                        pub_year = date_parts[0] if date_parts else ""

                        abstract = clean_html(doc.get("abstract", ""))
                        if not title or not doi:
                            continue

                        full_text = f"{title} {abstract} {query}"
                        p_subj, s_subj = infer_subjects(full_text)

                        records.append({
                            "Activity / Methodology": title,
                            "Category": cat,
                            "Suggested Course Title": f"Applied Educational Research ({query.title()})",
                            "Primary Subject": p_subj,
                            "Secondary Subject": s_subj,
                            "Description / Educational Rationale": abstract if abstract else f"Crossref peer-reviewed literature investigating {query}.",
                            "Classification Keywords": query,
                            "Scientific Backing (Source)": f"{journal} ({pub_year})",
                            "Evidence Level": "Peer-Reviewed Journal Article",
                            "DOI / URL": f"https://doi.org/{doi}"
                        })
                time.sleep(0.2)
            except Exception as e:
                print(f"    [-] Crossref error on '{query}': {e}")
                break

    print(f"  [✔] Crossref total extracted: {len(records)} records.")
    return records

def main():
    eric_data = fetch_eric_records()
    crossref_data = fetch_crossref_records()

    combined = eric_data + crossref_data
    if not combined:
        print("[-] No records fetched.")
        return

    df = pd.DataFrame(combined)

    # Deduplicate across APIs
    df.drop_duplicates(subset=["DOI / URL"], inplace=True)
    df.drop_duplicates(subset=["Activity / Methodology"], inplace=True)

    print(f"\n==================================================")
    print(f"[✔] SUCCESS: {len(df)} total unique academic records compiled!")
    print(f"==================================================")

    df.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    df.to_excel(OUTPUT_EXCEL, index=False, engine="openpyxl")

    print(f"[✔] Output saved to:")
    print(f"    - Excel: {os.path.abspath(OUTPUT_EXCEL)}")
    print(f"    - CSV:   {os.path.abspath(OUTPUT_CSV)}")

if __name__ == "__main__":
    main()
