import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
    2. Jika terdapat 33 pengalaman, Anda harus mengekstrak 33 baris tersebut.
    3. Nama Paket harus sesuai dengan yang tertulis.
    4. Tanggal harus diekstrak apa adanya (misal DD-MM-YYYY, atau hanya MM-YYYY, atau hanya YYYY).

    FORMAT OUTPUT (JSON ARRAY):
    [
      { "no": 1, "packageName": "...", "startDate": "...", "endDate": "..." },
      ...
    ]
  `;

  const response = await ai.models.generateContent({
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

  const rawText = response.text || "[]";
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

  if (onProgress) onProgress("Tahap 1: Mengekstrak seluruh daftar pengalaman profesional...");
  const rawExperiences = await extractExperiences(qualificationText);
  
  if (onProgress) onProgress("Tahap 2: Menganalisis kualifikasi dan menghitung skor...");

  const prompt = `
    Anda adalah asisten ahli Pokja Pemilihan Jasa Konsultansi Konstruksi.
    Tugas Anda adalah menilai Data Kualifikasi Tenaga Ahli secara mendetail berdasarkan kriteria yang ada di Dokumen Seleksi (BAB VI Lembar Kriteria Evaluasi) dan Kerangka Acuan Kerja (KAK).

    DATA DASAR:
    1. DOKUMEN SELEKSI (BAB VI): ${selectionDocText.substring(0, 120000)}
    2. KAK: ${kakText.substring(0, 90000)}
    3. DATA CV (TEKS): ${qualificationText.substring(0, 180000)}
    
    4. DAFTAR PENGALAMAN YANG SUDAH DIEKSTRAK (GUNAKAN INI SEBAGAI BASIS UTAMA):
    ${JSON.stringify(rawExperiences)}

    TUGAS UTAMA:
    Gunakan daftar pengalaman yang sudah diekstrak di atas sebagai basis. Berikan penilaian untuk SETIAP baris pengalaman tersebut.

    ATURAN PENILAIAN SANGAT KETAT (MANDATORY):
    1. IDENTIFIKASI TENAGA AHLI: Dari Data CV, ambil Nama personil & Posisi yang Diusulkan.
    2. PENILAIAN UNSUR "TINGKAT DAN JURUSAN PENDIDIKAN":
       - Persyaratan Pendidikan dalam KAK: Ambil/ekstrak dari Dokumen KAK sesuai dengan "Posisi yang diusulkan" (misal: S1 Teknik Sipil).
       - Pendidikan TA yang ditawarkan: Ambil dari Data Kualifikasi/CV tenaga ahli.
       - Nilai: Berikan skor berdasarkan ketentuan "Kriteria Penilaian" di Bab VI. **PENTING: Cek apakah terdapat lampiran ijazah yang valid sesuai pendidikan yang ditawarkan.**
       - Bobot: Ambil bobot persentase untuk unsur Pendidikan dari Bab VI.
       - Nilai Akhir: Nilai x Bobot.
       - Keterangan AI: Penjelasan detail mengapa nilai tersebut diberikan (analisis kesesuaian dan keberadaan ijazah).
    3. PENILAIAN UNSUR "STATUS TENAGA AHLI" (DETAIL):
       - Bukti Potong/Lapor Pajak PPh 21: Isi "Ada dan mencantumkan nama jelas serta nama perusahaan yang sama dengan nama perusahaan peserta" jika ditemukan bukti pemotongan pajak penghasilan pasal 21 (BPA1) atas nama tenaga ahli dan perusahaan yang bersangkutan. Jika tidak ada/tidak sesuai, isi "Tidak ada / tidak mencantumkan nama jelas atau nama perusahaan berbeda dengan nama perusahaan peserta".
       - Status Tenaga Ahli: Isi "Tenaga Ahli tetap" jika bukti pemotongan pajak pasal 21 (BPA1) ada dan valid. Jika tidak, isi "Tenaga ahli tidak tetap".
       - Nilai: Berikan skor berdasarkan kriteria "Status tenaga ahli yang diusulkan" di Bab VI.
       - Bobot: Ambil bobot persentase untuk unsur Status Tenaga Ahli dari Bab VI.
       - Nilai Akhir: Nilai x Bobot.
       - Keterangan AI: Penjelasan mengenai keberadaan bukti potong pajak penghasilan dan status tenaga ahli yang diberikan.
    4. PENILAIAN UNSUR "SUBUNSUR LAIN-LAIN" (DETAIL):
       - Uraian Lain-lain: Isi dengan uraian di Subunsur Lain-lain dari Dokumen Seleksi Bab VI.
       - Penilaian: Isi "Memenuhi" jika dokumen yang dipersyaratkan (misalnya sertifikat kursus bahasa inggris, SKK) dilampirkan, "Tidak memenuhi" jika tidak ada,  "Memenuhi sebagian" jika melampirkan sebagian.
       - Nilai: Berikan skor berdasarkan kriteria "Subunsur lain-lain" di Bab VI.
       - Bobot: Ambil bobot persentase untuk unsur Subunsur Lain-lain dari Bab VI.
       - Nilai Akhir: Nilai x Bobot.
       - Keterangan AI: Penjelasan mengenai penilaian dan lampiran Subunsur Lain-lain.
    5. PENGALAMAN PROFESIONAL (DETAIL):
       - Anda WAJIB memproses SEMUA baris pengalaman dari DAFTAR PENGALAMAN YANG SUDAH DIEKSTRAK.
       - Tgl Mulai & Tgl Selesai: Gunakan data yang sudah diekstrak.
       - Bulan: Hitung selisih bulan (Selesai - Mulai).
         * ATURAN OVERLAP: Perhitungan overlap (pengurangan durasi yang beririsan) HANYA diberlakukan jika Nama Paket Pekerjaan di Dokumen Seleksi atau KAK mengandung kata: "Pengawasan", "Supervisi", atau "Manajemen Konstruksi". Jika tidak mengandung kata tersebut, overlap tidak perlu dikurangi (dihitung penuh).
         * ATURAN FORMAT TANGGAL:
           a. Jika hanya Bulan/Tahun (tanpa tgl): total bulan dikurangi 1.
           b. Jika hanya Tahun: hitung 25% dari total durasi tahun tersebut dalam bulan.
       - Lingkup: Nilai 1 (sesuai), 0.75 (menunjang), 0.5 (tidak sesuai) berdasarkan kriteria Bab VI terhadap paket pekerjaan.
       - Posisi: Nilai 1 (sesuai posisi yang diusulkan), 0.5 (tidak sesuai) berdasarkan kriteria Bab VI.
       - Referensi: Nilai 1 (ada lampiran referensi/kontrak), 0 (tidak ada).
       - Jumlah: Bulan x Lingkup x Posisi x Referensi.
       - Keterangan AI: tuliskan nama paket pekerjaan dan Justifikasi secara rinci mengenai penilaian lingkup dan posisi serta keberadaan referensi.
    6. SKOR DISKRIT: Gunakan hanya skor (misal 100, 80, 50) yang tertulis di Bab VI.
    7. SYARAT KAK: Ekstrak jumlah tahun pengalaman minimum yang diminta (misal: 5 Tahun).

    FORMAT OUTPUT (JSON):
    Sesuai skema yang ditentukan.
  `;

  const response = await ai.models.generateContent({
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

  const rawText = response.text || "";
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

    let totalScore = 0;

    result.experienceAssessment = result.experienceAssessment.map(exp => {
      const recalculatedTotal = exp.months * exp.scope * exp.position * exp.reference;
      return { ...exp, total: recalculatedTotal };
    });

    result.criteriaScores = result.criteriaScores.map(criterion => {
      let b = criterion.bobot;
      if (b > 1) {
        b = b / 100;
      }
      const final = criterion.score * b;
      totalScore += final;
      return { 
        ...criterion, 
        bobot: b,
        nilaiAkhir: final
      };
    });

    // Check if separate assessments are missing from criteriaScores and add them if they are
    // But usually AI includes them if told it's a Rekapitulasi. 
    // To be conservative and match the 59.0 summary, we just sum correctly.
    // If the sum is still double counting, it means the separate assessments ARE in criteriaScores.
    // So starting at 0 is correct.

    result.overallScore = Number(totalScore.toFixed(2));

    return result;
  } catch (parseError) {
    console.error("Failed to parse Gemini JSON:", parseError, "Raw text:", rawText);
    throw new Error("Gagal mengolah hasil penilaian kualifikasi dari AI. Silakan coba lagi.");
  }
}
