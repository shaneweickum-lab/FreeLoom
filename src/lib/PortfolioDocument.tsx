import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

const DEFAULT_ACCENT = "#c7a252";

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  lockup: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 40, height: 40, borderRadius: 8 },
  monogram: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  monogramText: { color: "#fff", fontSize: 16, fontWeight: 700 },
  schoolName: { fontSize: 11, fontWeight: 700 },

  title: { fontSize: 20, fontWeight: 700, marginTop: 18, marginBottom: 2 },
  subtitle: { fontSize: 10, color: "#555", marginBottom: 18 },

  classHeading: { fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },

  entry: { borderWidth: 1, borderColor: "#ddd", borderRadius: 6, padding: 10, marginBottom: 10 },
  entryDate: { fontSize: 8, color: "#888", marginBottom: 4 },
  entryQuote: { fontSize: 9, fontStyle: "italic", color: "#555", marginBottom: 6 },
  entryTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 },
  entryTitle: { fontSize: 10.5, fontWeight: 700, flex: 1, marginRight: 8 },
  entryCredit: { fontSize: 8.5, color: "#fff", borderRadius: 8, paddingVertical: 2, paddingHorizontal: 6 },
  entryReasoning: { fontSize: 9, color: "#333", lineHeight: 1.4 },

  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7, color: "#999", textAlign: "center" },
});

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US");
}

export type PortfolioPdfEntry = {
  id: string;
  createdAt: string;
  rawWordDump: string;
  finalDescription: string | null;
  finalReasoning: string | null;
  creditValue: number;
};

export type PortfolioPdfClass = {
  id: string;
  title: string;
  subjectArea: string;
  entries: PortfolioPdfEntry[];
};

export type PortfolioPdfData = {
  studentName: string;
  generatedAt: string;
  classes: PortfolioPdfClass[];
  school: {
    schoolName: string | null;
    logoUrl: string | null;
    accentColor: string | null;
  };
};

/** Unlike TranscriptDocument (a formal, grade/GPA-oriented document), this
 * is the portfolio's own narrative: what a student actually did, and the
 * reasoning behind why it counts -- matching the same "reasoning shown
 * right alongside" story FreeLoom's own landing page tells, not a
 * transcript's official-record framing. */
export function PortfolioDocument({ studentName, generatedAt, classes, school }: PortfolioPdfData) {
  const accent = school.accentColor || DEFAULT_ACCENT;
  const monogram = (school.schoolName || studentName || "F").trim().charAt(0).toUpperCase() || "F";
  const totalCredits = classes.reduce(
    (sum, cls) => sum + cls.entries.reduce((s, e) => s + e.creditValue, 0),
    0
  );

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>{studentName}&apos;s Learning Portfolio</Text>
            <Text style={styles.subtitle}>
              Generated {formatDate(generatedAt)} · {totalCredits.toFixed(2)} total credits
            </Text>
          </View>
          <View style={styles.lockup}>
            {school.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image, not an HTML img
              <Image src={school.logoUrl} style={styles.logo} />
            ) : (
              <View style={[styles.monogram, { backgroundColor: accent }]}>
                <Text style={styles.monogramText}>{monogram}</Text>
              </View>
            )}
            {school.schoolName && <Text style={styles.schoolName}>{school.schoolName}</Text>}
          </View>
        </View>

        {classes.length === 0 ? (
          <Text style={{ fontSize: 9, color: "#888", marginTop: 12 }}>No entries selected.</Text>
        ) : (
          classes.map((cls) => (
            <View key={cls.id}>
              <Text style={[styles.classHeading, { color: accent }]}>
                {cls.title.toUpperCase()} — {cls.subjectArea}
              </Text>
              {cls.entries.map((entry) => (
                <View key={entry.id} style={styles.entry} wrap={false}>
                  <Text style={styles.entryDate}>{formatDate(entry.createdAt)}</Text>
                  <Text style={styles.entryQuote}>&ldquo;{entry.rawWordDump}&rdquo;</Text>
                  <View style={styles.entryTitleRow}>
                    <Text style={styles.entryTitle}>{entry.finalDescription || "Untitled entry"}</Text>
                    <Text style={[styles.entryCredit, { backgroundColor: accent }]}>
                      {entry.creditValue.toFixed(2)} cr
                    </Text>
                  </View>
                  {entry.finalReasoning && <Text style={styles.entryReasoning}>{entry.finalReasoning}</Text>}
                </View>
              ))}
            </View>
          ))
        )}

        <Text style={styles.footer} fixed>
          Generated with FreeLoom — real learning, formally recorded.
        </Text>
      </Page>
    </Document>
  );
}
