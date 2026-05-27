import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export function isQuotaExceededError(err: any): boolean {
  if (!err) return false;
  const errMsg = String(err.message || err.statusText || err || "").toLowerCase();
  const errCode = String(err.status || err.statusCode || err.code || err.error?.code || "");
  const errStatus = String(err.error?.status || "");

  return (
    errCode === "429" ||
    errMsg.includes("429") ||
    errMsg.includes("quota") ||
    errMsg.includes("exhausted") ||
    errMsg.includes("limit") ||
    errStatus.includes("RESOURCE_EXHAUSTED") ||
    errMsg.includes("resource_exhausted") ||
    errMsg.includes("too many requests") ||
    errMsg.includes("rate limit")
  );
}

export interface EvaluationResult {
  personnelName: string;
  proposedPosition: string;
  overallScore: number;
  educationAssessment: {
    no: number;
    kakRequirement: string;
    offeredEducation: string;
    score: number;
    weight: number;
    finalScore: number;
    aiRemark: string;
  };
  otherSubAssessment: {
    no: number;
    description: string;
    evaluation: string;
    score: number;
    weight: number;
    finalScore: number;
    aiRemark: string;
  };
  statusAssessment: {
    no: number;
    taxProof: string;
    employmentStatus: string;
    score: number;
    weight: number;
    finalScore: number;
    aiRemark: string;
  };
  experienceAssessment: {
    no: number;
    startDate: string;
    endDate: string;
    months: number;
    scope: number;
    position: number;
    reference: number;
    total: number;
    aiRemark: string;
  }[];
  criteriaScores: {
    no: number;
    name: string;
    score: number;
    bobot: number;
    nilaiAkhir: number;
    justification: string;
  }[];
  summary: string;
  requiredExperience?: string;
}

export interface ExtractedExperience {
  no: number;
  packageName: string;
  startDate: string;
  endDate: string;
}

async function extractExperiences(qualificationText: string): Promise<ExtractedExperience[]> {
  const model = "gemini-3-flash-preview";
  const prompt = `
    Tugas Anda adalah mengekstrak SELURUH daftar pengalaman kerja profesional yang tertulis dalam Data Kualifikasi/CV Tenaga Ahli berikut.
    
    DATA CV:
    ${qualificationText.substring(0, 180000)}

    ATURAN:
    1. Ekstrak SEMUA pengalaman tanpa terkecuali. Jangan meringkas atau melewati baris mana pun.
    2. Nama Paket harus sesuai dengan yang tertulis.
    3. Tanggal harus diekstrak apa adanya (misal DD-MM-YYYY, atau hanya MM-YYYY, atau hanya YYYY).

    FORMAT OUTPUT (JSON ARRAY):
    [
      { "no": 1, "packageName": "...", "startDate": "...", "endDate": "..." },
      ...
    ]
  `;

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              no: { type: Type.NUMBER },
              packageName: { type: Type.STRING },
              startDate: { type: Type.STRING },
              endDate: { type: Type.STRING }
            },
            required: ["no", "packageName", "startDate", "endDate"]
          }
        }
      }
    });
  } catch (error: any) {
    if (isQuotaExceededError(error)) {
      throw new Error("KUOTA_AI_HABIS: Batas penggunaan model AI telah habis. Silakan tunggu sampai pukul 14.00 WIB sebelum mencoba kembali, atau upgrade ke layanan berbayar.");
    }
    throw error;
  }

  const rawText = response?.text || "[]";
  try {
    return JSON.parse(rawText.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (e) {
    console.error("Failed to parse extracted experiences:", e);
    return [];
  }
}

export async function evaluateQualification(
  selectionDocText: string,
  kakText: string,
  qualificationText: string,
  onProgress?: (step: string) => void
): Promise<EvaluationResult> {
  const model = "gemini-3-flash-preview";

  if (onProgress) onProgress("Tahap 1: Sedang membaca seluruh data yang diunggah...");
  const rawExperiences = await extractExperiences(qualificationText);
  
  if (onProgress) onProgress("Tahap 2: Menganalisis data tenaga ahli, perkiraan waktu 1 - 3 menit");

  const prompt = `
    Anda adalah asisten ahli Pokja Pemilihan Jasa Konsultansi Konstruksi.
    Tugas Anda adalah menilai Data Kualifikasi Tenaga Ahli secara mendetail berdasarkan kriteria yang ada di Dokumen Seleksi pada BAB VI Lembar Kriteria Evaluasi.

    DATA DASAR:
    1. DOKUMEN SELEKSI (BAB VI): ${selectionDocText.substring(0, 120000)}
    2. KAK: ${kakText.substring(0, 90000)}
    3. DATA CV (TEKS): ${qualificationText.substring(0, 180000)}
    
    4. DAFTAR PENGALAMAN YANG SUDAH DIEKSTRAK (GUNAKAN INI SEBAGAI BASIS UTAMA):
    ${JSON.stringify(rawExperiences)}

    TUGAS UTAMA:
    Gunakan daftar pengalaman yang sudah diekstrak di atas sebagai basis penilaian pengalaman profesional tenaga ahli. Berikan penilaian untuk SETIAP baris pengalaman tersebut.

    ATURAN PENILAIAN SANGAT KETAT (MANDATORY):
    1. IDENTIFIKASI TENAGA AHLI: Dari Data CV, ambil Nama personil & Posisi penugasan yang Diusulkan.
    2. PENILAIAN UNSUR "TINGKAT DAN JURUSAN PENDIDIKAN":
       - Persyaratan Pendidikan dalam KAK: Ambil dari KAK sesuai dengan "Posisi yang diusulkan".
       - Pendidikan TA yang ditawarkan: Ambil dari Data Kualifikasi/CV tenaga ahli.
       - Nilai: Berikan skor berdasarkan ketentuan "Kriteria Penilaian" di Bab VI. **PENTING: Cek apakah terdapat lampiran scan ijazah yang valid sesuai pendidikan yang ditawarkan.**
       - Bobot: Ambil bobot persentase untuk unsur Pendidikan dari Bab VI.
       - Nilai Akhir: Nilai x Bobot.
       - Keterangan AI: Penjelasan detail mengapa nilai tersebut diberikan (analisis kesesuaian dan keberadaan scan ijazah).
    3. PENILAIAN UNSUR "STATUS TENAGA AHLI" (DETAIL):
       - Bukti Potong/Lapor Pajak PPh 21: Isi "Ada dan mencantumkan nama jelas serta nama perusahaan yang sama dengan nama perusahaan peserta" jika ditemukan scan pemotongan pajak penghasilan pasal 21 (BPA1) untuk Tenaga ahli. Jika tidak ada, isi "Tidak ada / tidak mencantumkan nama jelas atau nama perusahaan berbeda dengan nama perusahaan peserta".
       - Status Tenaga Ahli: Isi "Tenaga Ahli tetap" jika ditemukan pemotongan pajak pasal 21 (BPA1). Jika tidak, isi "Tenaga ahli tidak tetap".
       - Nilai: Berikan skor berdasarkan kriteria "Status tenaga ahli yang diusulkan" di Bab VI.
       - Bobot: Ambil bobot persentase untuk unsur Status Tenaga Ahli dari Bab VI.
       - Nilai Akhir: Nilai x Bobot.
       - Keterangan AI: Penjelasan mengenai keberadaan bukti scan potong pajak penghasilan dan status tenaga ahli yang diberikan.
    4. PENILAIAN UNSUR "SUBUNSUR LAIN-LAIN" (DETAIL):
       - Uraian Lain-lain: Isi dengan uraian di Subunsur Lain-lain dari Dokumen Seleksi Bab VI.
       - Penilaian: Isi "Memenuhi" jika dokumen yang dipersyaratkan (misalnya sertifikat kursus bahasa inggris, SKK) dilampirkan, "Tidak memenuhi" jika tidak ada,  "Memenuhi sebagian" jika melampirkan sebagian.
       - Nilai: Berikan skor berdasarkan kriteria "Subunsur lain-lain" di Bab VI.
       - Bobot: Ambil bobot persentase untuk unsur Subunsur Lain-lain dari Bab VI.
       - Nilai Akhir: Nilai x Bobot.
       - Keterangan AI: Penjelasan mengenai penilaian dan scan lampiran Subunsur Lain-lain.
    5. PENGALAMAN PROFESIONAL (DETAIL):
       - Anda WAJIB memproses SEMUA baris pengalaman dari DAFTAR PENGALAMAN YANG SUDAH DIEKSTRAK.
       - Tgl Mulai & Tgl Selesai: Gunakan data yang sudah diekstrak.
       - Bulan: Hitung selisih bulan (Selesai - Mulai).
         * ATURAN OVERLAP: Perhitungan overlap (pengurangan durasi yang beririsan) HANYA diberlakukan jika Nama Paket Pekerjaan di Dokumen Seleksi atau KAK mengandung kata: "Pengawasan", "Supervisi", atau "Manajemen Konstruksi". Jika tidak mengandung kata tersebut, overlap tidak perlu dikurangi (dihitung penuh).
         * ATURAN FORMAT TANGGAL:
           a. Jika hanya Bulan/Tahun (tanpa tgl): total bulan dikurangi 1.
           b. Jika hanya Tahun: hitung 25% dari total durasi tahun tersebut dalam bulan.
       - Lingkup: Nilai 1 (sesuai), 0.75 (menunjang), 0.5 (tidak sesuai) berdasarkan kriteria Bab VI terhadap paket pekerjaan yang dinilai.
       - Posisi: Nilai 1 (sesuai posisi yang diusulkan), 0.5 (tidak sesuai) berdasarkan kriteria Bab VI.
       - Referensi: Nilai 1 (ada lampiran scan referensi), 0 (tidak ada).
       - Jumlah: Bulan x Lingkup x Posisi x Referensi.
       - Keterangan AI: tuliskan nama paket pekerjaan dan Justifikasi mengenai penilaian lingkup dan posisi serta keberadaan scan referensi.
    6. SKOR DISKRIT: Gunakan hanya skor (misal 100, 80, 50) yang tertulis di Bab VI.
    7. SYARAT KAK: Ekstrak jumlah tahun pengalaman minimum yang diminta (misal: 5 Tahun).
    8. REKAPITULASI HASIL PENILAIAN (criteriaScores):
       Tabel ini WAJIB merupakan tabel rekapitulasi yang hanya berisi tepat 4 (empat) baris unsur penilaian berikut secara berurutan:
       - Baris 1: Tingkat dan Jurusan Pendidikan
       - Baris 2: Pengalaman Kerja Profesional
       - Baris 3: Status Tenaga Ahli
       - Baris 4: Subunsur lain-lain
       Untuk setiap baris, berikan properti "no" (1 sampai 4), "name" (sesuai nama unsur di atas), "score", "bobot" (dari lembar kriteria evaluasi Bab VI), "nilaiAkhir" (skor * bobot), dan "justification" (penjelasan singkat basis penilaian tersebut).

    FORMAT OUTPUT (JSON):
    Sesuai skema yang ditentukan.
  `;

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "Kamu adalah agen AI analisis data yang sangat teliti, logis, dan mengutamakan akurasi 100%. Tugasmu adalah memproses data yang diberikan oleh pengguna. Aturan Wajib Sebelum Merespon: Kamu TIDAK BOLEH langsung memberikan jawaban akhir. Kamu WAJIB menjabarkan proses berpikirmu secara bertahap (langkah demi langkah) di dalam struktur analisis internal menggunakan metode Chain of Thought.",
      //  thinkingLevel: "high",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            personnelName: { type: Type.STRING },
            proposedPosition: { type: Type.STRING },
            overallScore: { type: Type.NUMBER },
            educationAssessment: {
              type: Type.OBJECT,
              properties: {
                no: { type: Type.NUMBER },
                kakRequirement: { type: Type.STRING },
                offeredEducation: { type: Type.STRING },
                score: { type: Type.NUMBER },
                weight: { type: Type.NUMBER },
                finalScore: { type: Type.NUMBER },
                aiRemark: { type: Type.STRING }
              },
              required: ["no", "kakRequirement", "offeredEducation", "score", "weight", "finalScore", "aiRemark"]
            },
            statusAssessment: {
              type: Type.OBJECT,
              properties: {
                no: { type: Type.NUMBER },
                taxProof: { type: Type.STRING },
                employmentStatus: { type: Type.STRING },
                score: { type: Type.NUMBER },
                weight: { type: Type.NUMBER },
                finalScore: { type: Type.NUMBER },
                aiRemark: { type: Type.STRING }
              },
              required: ["no", "taxProof", "employmentStatus", "score", "weight", "finalScore", "aiRemark"]
            },
            otherSubAssessment: {
              type: Type.OBJECT,
              properties: {
                no: { type: Type.NUMBER },
                description: { type: Type.STRING },
                evaluation: { type: Type.STRING },
                score: { type: Type.NUMBER },
                weight: { type: Type.NUMBER },
                finalScore: { type: Type.NUMBER },
                aiRemark: { type: Type.STRING }
              },
              required: ["no", "description", "evaluation", "score", "weight", "finalScore", "aiRemark"]
            },
            experienceAssessment: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  no: { type: Type.NUMBER },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                  months: { type: Type.NUMBER },
                  scope: { type: Type.NUMBER },
                  position: { type: Type.NUMBER },
                  reference: { type: Type.NUMBER },
                  total: { type: Type.NUMBER },
                  aiRemark: { type: Type.STRING }
                },
                required: ["no", "startDate", "endDate", "months", "scope", "position", "reference", "total", "aiRemark"]
              }
            },
            criteriaScores: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  no: { type: Type.NUMBER },
                  name: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  bobot: { type: Type.NUMBER },
                  nilaiAkhir: { type: Type.NUMBER },
                  justification: { type: Type.STRING }
                },
                required: ["no", "name", "score", "bobot", "nilaiAkhir", "justification"]
              }
            },
            summary: { type: Type.STRING },
            requiredExperience: { type: Type.STRING }
          },
          required: ["personnelName", "proposedPosition", "overallScore", "educationAssessment", "statusAssessment", "otherSubAssessment", "experienceAssessment", "criteriaScores", "summary", "requiredExperience"]
        }
      }
    });
  } catch (error: any) {
    if (isQuotaExceededError(error)) {
      throw new Error("KUOTA_AI_HABIS: Batas penggunaan model AI telah habis. Silakan tunggu sampai pukul 14.00 WIB sebelum mencoba kembali, atau upgrade ke layanan berbayar.");
    }
    throw error;
  }

  const rawText = response?.text || "";
  console.log("Raw Gemini Response:", rawText);

  try {
    const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(cleanJson) as EvaluationResult;

    // Normalization guard for weights (scale down if AI returns percentages like 10 instead of 0.1)
    if (result.educationAssessment.weight > 1) {
      result.educationAssessment.weight = result.educationAssessment.weight / 100;
    }
    // Always recalculate to ensure consistency
    result.educationAssessment.finalScore = result.educationAssessment.score * result.educationAssessment.weight;
    
    // Normalization for statusAssessment
    if (result.statusAssessment.weight > 1) {
      result.statusAssessment.weight = result.statusAssessment.weight / 100;
    }
    result.statusAssessment.finalScore = result.statusAssessment.score * result.statusAssessment.weight;

    // Normalization for otherSubAssessment
    if (result.otherSubAssessment.weight > 1) {
      result.otherSubAssessment.weight = result.otherSubAssessment.weight / 100;
    }
    result.otherSubAssessment.finalScore = result.otherSubAssessment.score * result.otherSubAssessment.weight;

    // Recalculate experience assessment totals
    result.experienceAssessment = result.experienceAssessment.map(exp => {
      const recalculatedTotal = exp.months * exp.scope * exp.position * exp.reference;
      return { ...exp, total: recalculatedTotal };
    });

    // Enforce exactly 4 rows for criteriaScores
    const expectedCriteria = [
      { id: 1, key: "education", name: "Tingkat dan Jurusan Pendidikan" },
      { id: 2, key: "experience", name: "Pengalaman Kerja Profesional" },
      { id: 3, key: "status", name: "Status Tenaga Ahli" },
      { id: 4, key: "other", name: "Subunsur lain-lain" }
    ];

    const normalizedCriteriaScores: any[] = [];
    let totalScore = 0;

    expectedCriteria.forEach((expected, i) => {
      // Find matching criterion from AI response to retrieve custom experience score/weight or custom comments
      let matched = result.criteriaScores?.find(c => {
        const cName = (c.name || "").toLowerCase();
        if (expected.key === "education") {
          return cName.includes("pendidikan") || cName.includes("education") || cName.includes("tingkat");
        } else if (expected.key === "experience") {
          return cName.includes("pengalaman") || cName.includes("experience") || cName.includes("kerja") || cName.includes("profesional");
        } else if (expected.key === "status") {
          return cName.includes("status") || cName.includes("kepegawaian") || (cName.includes("ahli") && (cName.includes("tempat") || cName.includes("tetap") || cName.includes("tidak") || !cName.includes("pengalaman")));
        } else if (expected.key === "other") {
          return cName.includes("lain") || cName.includes("other") || cName.includes("subunsur");
        }
        return false;
      });

      let score = 0;
      let bobot = 0;
      let justification = "";

      if (expected.key === "education" && result.educationAssessment) {
        score = result.educationAssessment.score;
        bobot = result.educationAssessment.weight;
        justification = result.educationAssessment.aiRemark;
      } else if (expected.key === "status" && result.statusAssessment) {
        score = result.statusAssessment.score;
        bobot = result.statusAssessment.weight;
        justification = result.statusAssessment.aiRemark;
      } else if (expected.key === "other" && result.otherSubAssessment) {
        score = result.otherSubAssessment.score;
        bobot = result.otherSubAssessment.weight;
        justification = result.otherSubAssessment.aiRemark;
      } else if (expected.key === "experience") {
        if (matched) {
          score = typeof matched.score === "number" ? matched.score : 0;
          bobot = typeof matched.bobot === "number" ? matched.bobot : 0.40;
          justification = matched.justification || "";
        } else {
          // Fallback if AI didn't include experience in criteriaScores
          const expCriterion = result.criteriaScores?.find(c => (c.name || "").toLowerCase().includes("pengalaman") || (c.name || "").toLowerCase().includes("experience"));
          score = expCriterion ? expCriterion.score : 0;
          bobot = expCriterion ? expCriterion.bobot : 0.40;
          justification = expCriterion ? expCriterion.justification : "Penilaian pengalaman kerja profesional berdasarkan kesesuaian KAK.";
        }
      }

      if (bobot > 1) {
        bobot = bobot / 100;
      }
      
      const nilaiAkhir = score * bobot;
      totalScore += nilaiAkhir;

      normalizedCriteriaScores.push({
        no: expected.id,
        name: expected.name,
        score,
        bobot,
        nilaiAkhir,
        justification
      });
    });

    result.criteriaScores = normalizedCriteriaScores;
    result.overallScore = Number(totalScore.toFixed(2));

    return result;
  } catch (parseError) {
    console.error("Failed to parse Gemini JSON:", parseError, "Raw text:", rawText);
    throw new Error("Gagal mengolah hasil penilaian kualifikasi dari AI. Silakan coba lagi.");
  }
}
