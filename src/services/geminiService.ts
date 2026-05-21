import { GoogleGenAI, Type } from "@google/genai";
import { EvaluationResult, ExtractedExperience } from "../types.js";

let aiClient: GoogleGenAI | null = null;

function getAi(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Kunci API Gemini (GEMINI_API_KEY) tidak ditemukan di env server.");
    }
    aiClient = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

function isQuotaExceededError(err: any): boolean {
  if (!err) return false;
  
  const msg = (err.message || err.statusText || "").toLowerCase();
  const status = String(err.status || err.statusCode || err.code || err.status_code || "");
  const details = typeof err.details === "string" ? err.details.toLowerCase() : "";
  const errText = JSON.stringify(err).toLowerCase();
  
  return (
    msg.includes("quota") ||
    msg.includes("exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("limit exceeded") ||
    msg.includes("limit_exceeded") ||
    msg.includes("resource_exhausted") ||
    msg.includes("429") ||
    status === "429" ||
    status.includes("EXHAUSTED") ||
    details.includes("quota") ||
    details.includes("exhausted") ||
    details.includes("rate limit") ||
    errText.includes("quota") ||
    errText.includes("exhausted") ||
    errText.includes("rate limit") ||
    errText.includes("429")
  );
}

function handleGeminiError(error: any): never {
  console.error("[Gemini Error Debug]:", error);
  
  if (isQuotaExceededError(error)) {
    throw new Error(
      "Batas kuota pemakaian model AI Gemini telah habis (Rate Limit / Quota Exceeded / Resource Exhausted).\n\n" +
      "Silakan coba beberapa saat lagi atau upgrade untuk meningkatkan batas kuota."
    );
  }
  
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("api key") || msg.includes("apikey") || msg.includes("unauthorized") || msg.includes("invalid key") || msg.includes("key not found")) {
    throw new Error(
      "Kunci API Gemini (GEMINI_API_KEY) tidak valid atau tidak diizinkan. Silakan periksa pengaturan Secrets Anda."
    );
  }

  throw new Error(error.message || "Gagal berkomunikasi dengan layanan AI Gemini.");
}

async function extractExperiencesRaw(
  qualificationText: string,
  qualificationBase64?: string
): Promise<ExtractedExperience[]> {
  const ai = getAi();
  const model = "gemini-3.5-flash";
  
  const contents: any[] = [];
  
  if (qualificationBase64) {
    contents.push({
      inlineData: {
        mimeType: "application/pdf",
        data: qualificationBase64
      }
    });
  }

  const promptText = `
    Tugas Anda adalah mengekstrak SELURUH daftar pengalaman kerja profesional yang tertulis dalam Data Kualifikasi/CV Tenaga Ahli berikut.
    
    ${qualificationBase64 ? "Gunakan dokumen PDF asli yang dilampirkan serta salinan teks di bawah ini untuk mengekstrak data secara lengkap dan akurat." : "Gunakan data teks di bawah ini:"}

    DATA CV (TEKS FALLBACK):
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

  contents.push({ text: promptText });

  try {
    const response = await ai.models.generateContent({
      model,
      contents,
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
    return JSON.parse(rawText.replace(/```json/g, "").replace(/```/g, "").trim());
  } catch (err) {
    handleGeminiError(err);
  }
}

async function extractExperiences(
  qualificationText: string,
  qualificationBase64?: string
): Promise<ExtractedExperience[]> {
  if (qualificationBase64) {
    try {
      console.log("[Gemini] Attempting multimodal experience extraction...");
      return await extractExperiencesRaw(qualificationText, qualificationBase64);
    } catch (err: any) {
      if (err.message && err.message.includes("Batas kuota pemakaian model AI Gemini")) {
        throw err;
      }
      console.warn("[Gemini] Multimodal extraction failed, retrying with pure text...", err);
    }
  }
  console.log("[Gemini] Extracting experiences using pure text fallback...");
  return await extractExperiencesRaw(qualificationText, undefined);
}

async function evaluateQualificationWithMode(
  ai: GoogleGenAI,
  model: string,
  selectionDoc: { text: string; base64?: string },
  kakDoc: { text: string; base64?: string },
  qualificationDoc: { text: string; base64?: string },
  rawExperiences: ExtractedExperience[],
  useMultimodal: boolean
): Promise<EvaluationResult> {
  const contents: any[] = [];
  
  if (useMultimodal && qualificationDoc.base64) {
    contents.push({
      inlineData: {
        mimeType: "application/pdf",
        data: qualificationDoc.base64
      }
    });
  }

const mainPromptText = `
    Anda adalah asisten ahli Pokja Pemilihan Jasa Konsultansi Konstruksi.
    Tugas Anda adalah menilai Kualifikasi Tenaga Ahli secara mendetail berdasarkan kriteria di Dokumen Seleksi pada BAB VI Lembar Kriteria Evaluasi.

    DATA DASAR:
    1. DOKUMEN SELEKSI (KRITERIA EVALUASI BAB VI - TEKS): ${selectionDoc.text.substring(0, 120000)}
    2. KAK (PERSYARATAN JABATAN & KUALIFIKASI - TEKS): ${kakDoc.text.substring(0, 90000)}
    3. DATA CV (ORGANISASI & REFERENSI TEKS): ${qualificationDoc.text.substring(0, 150000)}
    
    4. DAFTAR PENGALAMAN YANG SUDAH DIEKSTRAK (GUNAKAN INI SEBAGAI BASIS UTAMA):
    ${JSON.stringify(rawExperiences)}

    TUGAS UTAMA:
    Gunakan daftar pengalaman yang sudah diekstrak di atas sebagai basis penilaian pengalaman profesional tenaga ahli. Berikan penilaian untuk SETIAP baris pengalaman tersebut.
    ${useMultimodal ? "Cek elemen visual (gambar, foto, scan ijazah, bukti potong pajak, scan referensi, dll.) langsung dari file PDF CV asli yang dilampirkan untuk memvalidasi keberadaan fisik dokumen tersebut secara akurat." : "Gunakan data teks di atas untuk memvalidasi keberadaan dokumen pendukung seperti scan ijazah, bukti potong pajak, sertifikasi SKK, dan surat keterangan kerja."}

    ATURAN PENILAIAN SANGAT KETAT (MANDATORY):
    1. IDENTIFIKASI TENAGA AHLI: Dari Data CV, ambil Nama personil & Posisi penugasan yang Diusulkan.
    2. PENILAIAN UNSUR "TINGKAT DAN JURUSAN PENDIDIKAN":
       - Persyaratan Pendidikan dalam KAK: Ambil dari KAK sesuai dengan Posisi penugasan.
       - Pendidikan TA yang ditawarkan: Ambil dari Data Kualifikasi/CV tenaga ahli.
       - Nilai: Berikan skor berdasarkan ketentuan "Kriteria Penilaian" di Bab VI. **PENTING: Cek kesesuaian dan keberadaan lampiran ijazah ${useMultimodal ? "(scan ijazah asli/foto ijazah pada berkas PDF)" : "(berdasarkan berkas teks)"}.**
       - Bobot: Ambil bobot persentase untuk unsur Pendidikan dari Bab VI.
       - Nilai Akhir: Nilai x Bobot.
       - Keterangan AI: Penjelasan dari nilai yang diberikan (analisis kesesuaian dan konfirmasi keberadaan lampiran ijazah).
    3. PENILAIAN UNSUR "STATUS TENAGA AHLI":
       - Bukti Potong/Lapor Pajak PPh 21: Isi "Ada dan mencantumkan nama jelas serta nama perusahaan yang sama dengan nama perusahaan peserta" jika ditemukan bukti pemotongan pajak penghasilan pasal 21 (BPA1 atau form 1721-A1) ${useMultimodal ? "pada scan di berkas PDF" : "pada teks"}. Jika tidak ada, isi "Tidak ada / tidak mencantumkan nama jelas atau nama perusahaan berbeda dengan nama perusahaan peserta".
       - Status Tenaga Ahli: Isi "Tenaga Ahli tetap" jika ditemukan bukti pemotongan pajak pasal 21 (BPA1). Jika tidak, isi "Tenaga ahli tidak tetap".
       - Nilai: Berikan skor berdasarkan kriteria di Bab VI.
       - Bobot: Ambil bobot persentase untuk unsur Status Tenaga Ahli dari Bab VI.
       - Nilai Akhir: Nilai x Bobot.
       - Keterangan AI: Penjelasan mengenai keberadaan bukti potong pajak penghasilan dan status tenaga ahli yang diberikan.
    4. PENILAIAN UNSUR "SUBUNSUR LAIN-LAIN":
       - Uraian Lain-lain: Isi dengan uraian di Subunsur Lain-lain dari Dokumen Seleksi Bab VI.
       - Penilaian: Isi "Memenuhi" jika dokumen yang dipersyaratkan dilampirkan ${useMultimodal ? "sebagai scan pada berkas PDF" : "pada berkas teks"}, "Tidak memenuhi" jika tidak ada, "Memenuhi sebagian" jika melampirkan sebagian.
       - Nilai: Berikan skor berdasarkan kriteria di Bab VI.
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
       - Referensi: Nilai 1 jika ${useMultimodal ? "terdapat scan bukti referensi/surat keterangan kerja pada berkas PDF asli" : "berdasarkan teks tertulis terdapat lampiran referensi/kontrak asli"}, 0 jika tidak ada.
       - Jumlah: Bulan x Lingkup x Posisi x Referensi.
       - Keterangan AI: tuliskan nama paket pekerjaan dan Justifikasi mengenai penilaian lingkup dan posisi serta keberadaan bukti referensi.
    6. SKOR DISKRIT: Gunakan hanya skor (misal 100, 80, 50) yang tertulis di Bab VI.
    7. SYARAT KAK: Ekstrak jumlah tahun pengalaman minimum yang diminta (misal: 5 tahun).

    FORMAT OUTPUT (JSON):
    Sesuai skema respon.
  `;

  contents.push({ text: mainPromptText });

  try {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
      //  systemInstruction: "Kamu adalah agen AI analisis data yang sangat teliti, logis, dan mengutamakan akurasi 100%. Tugasmu adalah memproses kriteria evaluasi dan data riwayat hidup personil. Selalu gunakan kerangka berfikir analitis Chain of Thought untuk melakukan verifikasi silang.",
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
          required: [
            "personnelName", 
            "proposedPosition", 
            "overallScore", 
            "educationAssessment", 
            "statusAssessment", 
            "otherSubAssessment", 
            "experienceAssessment", 
            "criteriaScores", 
            "summary", 
            "requiredExperience"
          ]
        }
      }
    });

    const rawText = response.text || "";
    console.log(`[Gemini Mode ${useMultimodal ? "Multimodal" : "Text"}] Response length: ${rawText.length}`);

    const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanJson) as EvaluationResult;
  } catch (err) {
    handleGeminiError(err);
  }
}

export async function evaluateQualification(
  selectionDoc: { text: string; base64?: string },
  kakDoc: { text: string; base64?: string },
  qualificationDoc: { text: string; base64?: string },
  onProgress?: (step: string) => void
): Promise<EvaluationResult> {
  const ai = getAi();
  const model = "gemini-3.5-flash";

  if (onProgress) onProgress("Tahap 1: Membaca rincian CV dan menyusun daftar riwayat bertahap...");
  const rawExperiences = await extractExperiences(qualificationDoc.text, qualificationDoc.base64);
  
  if (onProgress) onProgress("Tahap 2: Menganalisis berkas dan scan lampiran visual (Ijazah, SKK, PPh 21, Surat Referensi)...");

  let result: EvaluationResult;
  try {
    // Attempt multimodal parsing using ONLY CV visual PDF input to keep sizes optimized and avoid 500 error
    console.log("[Gemini] Running evaluation with multimodal CV attachment...");
    result = await evaluateQualificationWithMode(
      ai,
      model,
      selectionDoc,
      kakDoc,
      qualificationDoc,
      rawExperiences,
      true
    );
  } catch (multimodalErr: any) {
    if (multimodalErr.message && multimodalErr.message.includes("Batas kuota pemakaian model AI Gemini")) {
      throw multimodalErr;
    }
    console.error("[Gemini] Multimodal evaluation failed. Falling back to structured text evaluation...", multimodalErr);
    if (onProgress) onProgress("Mendeteksi aktivitas berlebih pada engine multimodal, beralih ke analisis berbasis teks (fallback)...");
    
    result = await evaluateQualificationWithMode(
      ai,
      model,
      selectionDoc,
      kakDoc,
      qualificationDoc,
      rawExperiences,
      false
    );
  }

  try {
    // Weight scaling normalization
    if (result.educationAssessment.weight > 1) {
      result.educationAssessment.weight = result.educationAssessment.weight / 100;
    }
    result.educationAssessment.finalScore = result.educationAssessment.score * result.educationAssessment.weight;
    
    if (result.statusAssessment.weight > 1) {
      result.statusAssessment.weight = result.statusAssessment.weight / 100;
    }
    result.statusAssessment.finalScore = result.statusAssessment.score * result.statusAssessment.weight;

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

    result.overallScore = Number(totalScore.toFixed(2));

    return result;
  } catch (parseError) {
    console.error("Failed to parse Gemini JSON:", parseError);
    throw new Error("Gagal mengolah hasil penilaian kualifikasi dari AI. Silakan coba lagi.");
  }
}
