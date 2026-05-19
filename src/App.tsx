/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { 
  FileUp, 
  FileText, 
  CheckCircle2, 
  Loader2, 
  ShieldCheck, 
  Trash2, 
  Play,
  FileCheck,
  AlertCircle,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileDown
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import { evaluateQualification, type EvaluationResult } from "./services/geminiService";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const formatIndonesianDate = (dateStr: string) => {
  if (!dateStr || dateStr === "-" || dateStr.toLowerCase() === "n/a") return dateStr;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("id-ID", { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

interface DocState {
  file: File | null;
  text: string;
}

interface ProposalState {
  files: File[];
  texts: string[];
}

export default function App() {
  const [selectionDoc, setSelectionDoc] = useState<DocState>({ file: null, text: "" });
  const [kakDoc, setKakDoc] = useState<DocState>({ file: null, text: "" });
  const [qualificationDoc, setQualificationDoc] = useState<DocState>({ file: null, text: "" });
  
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCheckingPageCount, setIsCheckingPageCount] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [processStep, setProcessStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);

  const extractText = async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];
    
    const { extractTextFromPdf } = await import("./lib/pdfExtractor");
    
    console.log(`[Client] Processing ${files.length} files for client-side extraction...`);
    const results: string[] = [];

    for (const file of files) {
      try {
        console.log(`[Client] Extracting: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        const text = await extractTextFromPdf(file);
        console.log(`[Client] Extracted ${text.length} characters from ${file.name}`);
        results.push(text);
      } catch (err: any) {
        console.error(`[Client] Extraction error on file ${file.name}:`, err);
        throw err;
      }
    }

    return results;
  };

  const onDropSelectionDoc = async (acceptedFiles: File[]) => {
    try {
      if (acceptedFiles[0]) {
        setSelectionDoc({ file: acceptedFiles[0], text: "" });
        setError(null);
        console.log("Dokumen Seleksi terpilih:", acceptedFiles[0].name);
      }
    } catch (err) {
      setError("Gagal memilih file. Pastikan file adalah PDF yang valid.");
    }
  };

  const onDropKakDoc = async (acceptedFiles: File[]) => {
    try {
      if (acceptedFiles[0]) {
        setKakDoc({ file: acceptedFiles[0], text: "" });
        setError(null);
      }
    } catch (err) {
      setError("Gagal memilih file KAK.");
    }
  };

  const onDropQualificationDoc = async (acceptedFiles: File[]) => {
    try {
      if (acceptedFiles[0]) {
        const file = acceptedFiles[0];
        
        // Check page count limit
        const { getPdfPageCount } = await import("./lib/pdfExtractor");
        setIsCheckingPageCount(true);
        const pageCount = await getPdfPageCount(file);
        setIsCheckingPageCount(false);

        if (pageCount > 75) {
          setError(`File "${file.name}" memiliki ${pageCount} halaman. Batas maksimal adalah 75 halaman per tenaga ahli.`);
          return;
        }

        setQualificationDoc({ file, text: "" });
        setError(null);
      }
    } catch (err) {
      setIsCheckingPageCount(false);
      setError("Gagal memilih file Data Kualifikasi tenaga ahli.");
    }
  };

  const handleStartEvaluation = async () => {
    // Strict validation: all forms must be filled
    if (!selectionDoc.file) {
      setError("Mohon upload Dokumen Seleksi (BAB VI) terlebih dahulu.");
      return;
    }
    if (!kakDoc.file) {
      setError("Mohon upload Kerangka Acuan Kerja (KAK) terlebih dahulu.");
      return;
    }
    if (!qualificationDoc.file) {
      setError("Mohon upload Data Pengalaman Tenaga Ahli terlebih dahulu (data pengalaman untuk setiap tenaga Ahli harus terpisah, tidak boleh digabung menjadi 1 file)");
      return;
    }

    try {
      setIsExtracting(true);
      setError(null);
      setResult(null);

      console.log("[Client] Starting evaluation process...");
      
      let currentSelText = selectionDoc.text;
      let currentKakText = kakDoc.text;
      let currentQualText = qualificationDoc.text;

      // Only extract if text is missing
      if (!currentSelText) {
        console.log("[Client] Extracting Selection Document...");
        const res = await extractText([selectionDoc.file!]);
        currentSelText = res[0];
        setSelectionDoc(prev => ({ ...prev, text: currentSelText }));
      }

      if (!currentKakText) {
        console.log("[Client] Extracting KAK Document...");
        const res = await extractText([kakDoc.file!]);
        currentKakText = res[0];
        setKakDoc(prev => ({ ...prev, text: currentKakText }));
      }

      if (!currentQualText) {
        console.log("[Client] Extracting Qualification Document...");
        const res = await extractText([qualificationDoc.file!]);
        currentQualText = res[0];
        setQualificationDoc(prev => ({ ...prev, text: currentQualText }));
      }

      // Check for extraction errors
      const allResults = [currentSelText, currentKakText, currentQualText];
      const failedFile = allResults.find(t => t && typeof t === "string" && t.includes("[ERROR_EXTRACTION_FAILED:"));
      
      if (failedFile) {
        const errorMatch = failedFile.match(/\[ERROR_EXTRACTION_FAILED: ([^|\]]*)(?:\| Reason: ([^\]]*))?\]/);
        const fileName = errorMatch ? errorMatch[1].trim() : "dokumen";
        const reason = errorMatch && errorMatch[2] ? errorMatch[2].trim() : "File mungkin terproteksi atau format tidak didukung";
        throw new Error(`Gagal membaca "${fileName}": ${reason}. Silakan coba simpan ulang PDF Anda sebagai PDF standar.`);
      }

      if (!currentSelText?.trim() || !currentKakText?.trim() || !currentQualText?.trim()) {
        throw new Error("Satu atau lebih dokumen utama kosong setelah diekstrak. Mohon periksa kembali file Anda.");
      }

      setIsExtracting(false);
      setIsEvaluating(true);

      console.log("[Client] Sending data to AI for evaluation...");
      const evaluation = await evaluateQualification(
        currentSelText, 
        currentKakText, 
        currentQualText,
        (step) => setProcessStep(step)
      ).catch(evalErr => {
        if (evalErr.message?.includes('Failed to fetch') || evalErr.name === 'TypeError') {
            throw new Error("Gagal terhubung ke layanan AI. Pastikan koneksi internet stabil.");
        }
        throw evalErr;
      });
      setResult(evaluation);
    } catch (err) {
      console.error("[Client] Process failed:", err);
      setError(err instanceof Error ? err.message : "Terjadi kesalahan sistem saat memproses dokumen.");
    } finally {
      setIsExtracting(false);
      setIsEvaluating(false);
    }
  };

  const exportToPDF = () => {
    if (!result) return;
    const doc = new jsPDF() as any;
    
    // Add title
    doc.setFontSize(18);
    doc.setTextColor(31, 41, 55); // Gray-800
    doc.text("Laporan Hasil Penilaian Kualifikasi Tenaga Ahli", 14, 20);
    
    // Add score
    doc.setFontSize(12);
    doc.setTextColor(37, 99, 235); // Blue-600
    doc.text(`Skor Akhir Keseluruhan: ${result.overallScore}`, 14, 32);
    
    // Personnel Info
    doc.setFontSize(11);
    doc.setTextColor(31, 41, 55);
    doc.text(`Nama Personil: ${result.personnelName}`, 14, 40);
    doc.text(`Posisi yang Diusulkan: ${result.proposedPosition}`, 14, 46);
    
    // Add summary
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99); // Gray-600
    const summaryLines = doc.splitTextToSize(`Ringkasan: ${result.summary}`, 180);
    doc.text(summaryLines, 14, 54);

    // Calculate height of summary to determine table start position
    const summaryHeight = summaryLines.length * (doc.internal.getFontSize() / 72 * 25.4 * 1.2);
    let currentY = 60 + summaryHeight;

    // --- Table 1: Pendidikan ---
    doc.setFontSize(12);
    doc.text("Tingkat dan Jurusan Pendidikan", 14, currentY);
    currentY += 6;

    const eduData = [[
      result.educationAssessment.no,
      result.educationAssessment.kakRequirement,
      result.educationAssessment.offeredEducation,
      result.educationAssessment.score,
      `${(result.educationAssessment.weight * 100).toFixed(0)}%`,
      result.educationAssessment.finalScore.toFixed(2),
      result.educationAssessment.aiRemark
    ]];

    autoTable(doc, {
      startY: currentY,
      head: [["No", "Persyaratan Pendidikan dalam KAK", "Pendidikan TA Yang Ditawarkan", "Nilai", "Bobot", "Nilai Akhir", "Keterangan AI"]],
      body: eduData,
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 9, cellPadding: 2 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 15;

    // --- Table: Status Tenaga Ahli ---
    doc.setFontSize(12);
    doc.text("Status Tenaga Ahli", 14, currentY);
    currentY += 6;

    const statusData = [[
      result.statusAssessment.no,
      result.statusAssessment.taxProof,
      result.statusAssessment.employmentStatus,
      result.statusAssessment.score,
      `${(result.statusAssessment.weight * 100).toFixed(0)}%`,
      result.statusAssessment.finalScore.toFixed(2),
      result.statusAssessment.aiRemark
    ]];

    autoTable(doc, {
      startY: currentY,
      head: [["No", "Bukti Potong/Lapor Pajak PPh 21", "Status Tenaga Ahli", "Nilai", "Bobot", "Nilai Akhir", "Keterangan AI"]],
      body: statusData,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 9, cellPadding: 2 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 15;

    // --- Table: Subunsur Lain-lain ---
    doc.setFontSize(12);
    doc.text("Subunsur Lain-lain", 14, currentY);
    currentY += 6;

    const otherData = [[
      result.otherSubAssessment.no,
      result.otherSubAssessment.description,
      result.otherSubAssessment.evaluation,
      result.otherSubAssessment.score,
      `${(result.otherSubAssessment.weight * 100).toFixed(0)}%`,
      result.otherSubAssessment.finalScore.toFixed(2),
      result.otherSubAssessment.aiRemark
    ]];

    autoTable(doc, {
      startY: currentY,
      head: [["No", "Uraian Lain-lain", "Penilaian", "Nilai", "Bobot", "Nilai Akhir", "Keterangan AI"]],
      body: otherData,
      theme: 'grid',
      headStyles: { fillColor: [245, 158, 11] }, // Amber-500
      styles: { fontSize: 9, cellPadding: 2 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 15;

    // --- Table: Pengalaman Kerja ---
    doc.setFontSize(12);
    doc.text("Rincian Pengalaman Kerja Profesional", 14, currentY);
    currentY += 6;

    const expData = result.experienceAssessment.map(exp => [
      exp.no,
      formatIndonesianDate(exp.startDate),
      formatIndonesianDate(exp.endDate),
      exp.months,
      exp.scope,
      exp.position,
      exp.reference,
      exp.total.toFixed(2),
      exp.aiRemark
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["No", "Tgl Mulai", "Tgl Selesai", "Bulan", "Lingkup", "Posisi", "Referensi", "Jumlah", "Keterangan AI"]],
      body: expData,
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 9, cellPadding: 1.5 },
      columnStyles: {
        3: { halign: 'center' },
        4: { halign: 'center' },
        5: { halign: 'center' },
        6: { halign: 'center' },
        7: { halign: 'center' },
      }
    });

    currentY = (doc as any).lastAutoTable.finalY + 15;

    // --- Table 2: Unsur Lainnya ---
    doc.setFontSize(12);
    doc.text("REKAPITULASI NILAI TENAGA AHLI", 14, currentY);
    currentY += 6;

    const tableData = result.criteriaScores.map(item => [
      item.no,
      item.name,
      item.score,
      `${(item.bobot * 100).toFixed(0)}%`,
      item.nilaiAkhir.toFixed(2),
      item.justification
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["No", "Unsur Yang Dinilai", "Nilai", "Bobot", "Nilai Akhir", "Keterangan / Justifikasi"]],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [55, 65, 81] }, 
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 40 },
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 15, halign: 'center' },
        5: { cellWidth: 'auto' }
      }
    });

    doc.save(`Nilai_${result.personnelName || "Personil"}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const exportToExcel = async () => {
    if (!result) return;
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'POKJA DIY';
    workbook.lastModifiedBy = 'POKJA DIY';
    workbook.created = new Date();
    workbook.modified = new Date();

    const ws = workbook.addWorksheet('Laporan Penilaian');

    // Styles
    const titleStyle: Partial<ExcelJS.Style> = {
      font: { name: 'Arial', family: 4, size: 14, bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF808000' } }, // Olive Green
      alignment: { vertical: 'middle', horizontal: 'center' }
    };

    const sectionTitleStyle: Partial<ExcelJS.Style> = {
      font: { name: 'Arial', family: 4, size: 11, bold: true },
      alignment: { vertical: 'middle', horizontal: 'left' }
    };

    const tableHeaderStyle = (color: string): Partial<ExcelJS.Style> => ({
      font: { name: 'Arial', family: 4, size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: color } },
      alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
      border: {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    });

    const bodyStyle: Partial<ExcelJS.Style> = {
        font: { name: 'Arial', family: 4, size: 9 },
        alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
        border: {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        }
    };

    const centerStyle: Partial<ExcelJS.Style> = {
        ...bodyStyle,
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }
    };

    // Column Widths (A to I)
    ws.columns = [
        { width: 5 },  // A: No
        { width: 15 }, // B
        { width: 15 }, // C
        { width: 15 }, // D
        { width: 15 }, // E
        { width: 15 }, // F
        { width: 15 }, // G
        { width: 15 }, // H
        { width: 30 }  // I: Keterangan (some used for merging)
    ];

    // --- REPORT HEADER ---
    ws.mergeCells('A1:I1');
    const titleCell = ws.getCell('A1');
    titleCell.value = 'LAPORAN HASIL PENILAIAN KUALIFIKASI TENAGA AHLI';
    titleCell.style = titleStyle;
    ws.getRow(1).height = 35;

    ws.mergeCells('A2:I2');
    const subTitleCell = ws.getCell('A2');
    subTitleCell.value = 'Evaluasi Jasa Konsultansi Konstruksi';
    subTitleCell.style = { ...titleStyle, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF556B2F' } } };
    subTitleCell.font = { ...titleStyle.font, size: 11 };
    ws.getRow(2).height = 25;

    ws.getCell('A4').value = 'Tanggal Laporan:';
    ws.getCell('B4').value = new Date().toLocaleDateString("id-ID");
    ws.getCell('A4').font = { bold: true };

    ws.getCell('A5').value = 'Nama Personil:';
    ws.getCell('B5').value = result.personnelName;
    ws.getCell('A5').font = { bold: true };

    ws.getCell('A6').value = 'Posisi yang Diusulkan:';
    ws.getCell('B6').value = result.proposedPosition;
    ws.getCell('A6').font = { bold: true };

    let currentRow = 8;

    // --- SECTION 1: PENDIDIKAN ---
    ws.mergeCells(`A${currentRow}:I${currentRow}`);
    const eduTitle = ws.getCell(`A${currentRow}`);
    eduTitle.value = '1. TABEL PENILAIAN PENDIDIKAN';
    eduTitle.style = sectionTitleStyle;
    currentRow++;

    const eduHeaders = ["No", "Persyaratan Pendidikan (KAK)", "Pendidikan TA Ditawarkan", "Nilai", "Bobot", "Hasil", "Keterangan AI"];
    // Note: Keterangan AI will use merged cells B-C etc for better spacing if needed, but let's try direct first
    const eduHeadRow = ws.getRow(currentRow);
    // Values mapped to columns A, B, C, D, E, F, G (we have I in total)
    // We'll merge G:I for Keterangan AI
    eduHeadRow.getCell(1).value = "No";
    eduHeadRow.getCell(2).value = "Persyaratan Pendidikan (KAK)";
    eduHeadRow.getCell(3).value = "Pendidikan TA Ditawarkan";
    eduHeadRow.getCell(4).value = "Nilai";
    eduHeadRow.getCell(5).value = "Bobot";
    eduHeadRow.getCell(6).value = "Hasil";
    ws.mergeCells(`G${currentRow}:I${currentRow}`);
    eduHeadRow.getCell(7).value = "Keterangan AI";
    
    eduHeadRow.eachCell((cell) => {
      if (cell.value) cell.style = tableHeaderStyle('FF1976D2');
    });
    currentRow++;

    const eduData = ws.getRow(currentRow);
    eduData.getCell(1).value = result.educationAssessment.no;
    eduData.getCell(2).value = result.educationAssessment.kakRequirement;
    eduData.getCell(3).value = result.educationAssessment.offeredEducation;
    eduData.getCell(4).value = result.educationAssessment.score;
    eduData.getCell(5).value = result.educationAssessment.weight;
    eduData.getCell(6).value = result.educationAssessment.finalScore;
    ws.mergeCells(`G${currentRow}:I${currentRow}`);
    eduData.getCell(7).value = result.educationAssessment.aiRemark;

    eduData.eachCell((cell, col) => {
      if (col === 1 || col === 4 || col === 5 || col === 6) {
        cell.style = { ...centerStyle };
        if (col === 5) cell.numFmt = '0%';
      } else {
        cell.style = { ...bodyStyle };
      }
    });
    currentRow += 2;

    // --- SECTION 2: STATUS ---
    ws.mergeCells(`A${currentRow}:I${currentRow}`);
    ws.getCell(`A${currentRow}`).value = '2. TABEL PENILAIAN STATUS TENAGA AHLI';
    ws.getCell(`A${currentRow}`).style = sectionTitleStyle;
    currentRow++;

    const statusHeadRow = ws.getRow(currentRow);
    statusHeadRow.getCell(1).value = "No";
    statusHeadRow.getCell(2).value = "Bukti Pajak PPh 21";
    statusHeadRow.getCell(3).value = "Status Tenaga Ahli";
    statusHeadRow.getCell(4).value = "Nilai";
    statusHeadRow.getCell(5).value = "Bobot";
    statusHeadRow.getCell(6).value = "Hasil";
    ws.mergeCells(`G${currentRow}:I${currentRow}`);
    statusHeadRow.getCell(7).value = "Keterangan AI";
    statusHeadRow.eachCell(cell => { if(cell.value) cell.style = tableHeaderStyle('FF2E7D32') });
    currentRow++;

    const statusData = ws.getRow(currentRow);
    statusData.getCell(1).value = result.statusAssessment.no;
    statusData.getCell(2).value = result.statusAssessment.taxProof;
    statusData.getCell(3).value = result.statusAssessment.employmentStatus;
    statusData.getCell(4).value = result.statusAssessment.score;
    statusData.getCell(5).value = result.statusAssessment.weight;
    statusData.getCell(6).value = result.statusAssessment.finalScore;
    ws.mergeCells(`G${currentRow}:I${currentRow}`);
    statusData.getCell(7).value = result.statusAssessment.aiRemark;
    statusData.eachCell((cell, col) => {
      if (col === 1 || col === 4 || col === 5 || col === 6) {
        cell.style = { ...centerStyle };
        if (col === 5) cell.numFmt = '0%';
      } else {
        cell.style = { ...bodyStyle };
      }
    });
    currentRow += 2;

    // --- SECTION 3: SUBUNSUR LAIN ---
    ws.mergeCells(`A${currentRow}:I${currentRow}`);
    ws.getCell(`A${currentRow}`).value = '3. TABEL PENILAIAN SUBUNSUR LAIN-LAIN';
    ws.getCell(`A${currentRow}`).style = sectionTitleStyle;
    currentRow++;

    const otherHeadRow = ws.getRow(currentRow);
    otherHeadRow.getCell(1).value = "No";
    otherHeadRow.getCell(2).value = "Uraian Lain-lain";
    otherHeadRow.getCell(3).value = "Penilaian";
    otherHeadRow.getCell(4).value = "Nilai";
    otherHeadRow.getCell(5).value = "Bobot";
    otherHeadRow.getCell(6).value = "Hasil";
    ws.mergeCells(`G${currentRow}:I${currentRow}`);
    otherHeadRow.getCell(7).value = "Keterangan AI";
    otherHeadRow.eachCell(cell => { if(cell.value) cell.style = tableHeaderStyle('FFF57C00') });
    currentRow++;

    const otherData = ws.getRow(currentRow);
    otherData.getCell(1).value = result.otherSubAssessment.no;
    otherData.getCell(2).value = result.otherSubAssessment.description;
    otherData.getCell(3).value = result.otherSubAssessment.evaluation;
    otherData.getCell(4).value = result.otherSubAssessment.score;
    otherData.getCell(5).value = result.otherSubAssessment.weight;
    otherData.getCell(6).value = result.otherSubAssessment.finalScore;
    ws.mergeCells(`G${currentRow}:I${currentRow}`);
    otherData.getCell(7).value = result.otherSubAssessment.aiRemark;
    otherData.eachCell((cell, col) => {
      if (col === 1 || col === 4 || col === 5 || col === 6) {
        cell.style = { ...centerStyle };
        if (col === 5) cell.numFmt = '0%';
      } else {
        cell.style = { ...bodyStyle };
      }
    });
    currentRow += 2;

    // --- SECTION 4: PENGALAMAN ---
    ws.mergeCells(`A${currentRow}:I${currentRow}`);
    ws.getCell(`A${currentRow}`).value = '4. TABEL RINCIAN PENGALAMAN KERJA PROFESIONAL';
    ws.getCell(`A${currentRow}`).style = sectionTitleStyle;
    currentRow++;

    const expHeadRow = ws.getRow(currentRow);
    expHeadRow.getCell(1).value = "No";
    expHeadRow.getCell(2).value = "Tgl Mulai";
    expHeadRow.getCell(3).value = "Tgl Selesai";
    expHeadRow.getCell(4).value = "Bulan";
    expHeadRow.getCell(5).value = "Lingkup";
    expHeadRow.getCell(6).value = "Posisi";
    expHeadRow.getCell(7).value = "Referensi";
    expHeadRow.getCell(8).value = "Hasil";
    expHeadRow.getCell(9).value = "Keterangan AI";
    expHeadRow.eachCell(cell => cell.style = tableHeaderStyle('FF1565C0'));
    currentRow++;

    const expStartRow = currentRow;
    result.experienceAssessment.forEach((exp) => {
      const row = ws.getRow(currentRow);
      row.values = [
        exp.no,
        formatIndonesianDate(exp.startDate),
        formatIndonesianDate(exp.endDate),
        exp.months,
        exp.scope,
        exp.position,
        exp.reference,
        parseFloat(exp.total.toFixed(2)),
        exp.aiRemark
      ];
      row.eachCell((cell, col) => {
        if (col < 9) cell.style = centerStyle;
        else cell.style = bodyStyle;
      });
      currentRow++;
    });
    
    // Add SUM Row for Table 4
    const expSumRow = ws.getRow(currentRow);
    ws.mergeCells(`A${currentRow}:G${currentRow}`);
    expSumRow.getCell(1).value = "TOTAL BULAN PENGALAMAN ";
    expSumRow.getCell(1).style = { ...tableHeaderStyle('FF1565C0'), alignment: { horizontal: 'right', vertical: 'middle' } };
    expSumRow.getCell(8).value = { formula: `SUM(H${expStartRow}:H${currentRow - 1})` };
    expSumRow.getCell(8).style = centerStyle;
    expSumRow.getCell(8).font = { bold: true };
    currentRow++;

    const expYearRow = ws.getRow(currentRow);
    ws.mergeCells(`A${currentRow}:G${currentRow}`);
    expYearRow.getCell(1).value = "TOTAL TAHUN PENGALAMAN (BULAN / 12) ";
    expYearRow.getCell(1).style = { ...bodyStyle, font: { ...bodyStyle.font, bold: true }, alignment: { horizontal: 'right' } };
    expYearRow.getCell(8).value = { formula: `H${currentRow - 1}/12` };
    expYearRow.getCell(8).numFmt = '0.00';
    expYearRow.getCell(8).style = centerStyle;
    expYearRow.getCell(8).font = { bold: true };
    currentRow++;

    const expReqRow = ws.getRow(currentRow);
    ws.mergeCells(`A${currentRow}:G${currentRow}`);
    expReqRow.getCell(1).value = "SYARAT PENGALAMAN SESUAI KAK ";
    expReqRow.getCell(1).style = { ...bodyStyle, font: { ...bodyStyle.font, bold: true }, alignment: { horizontal: 'right' } };
    expReqRow.getCell(8).value = result.requiredExperience || "-";
    expReqRow.getCell(8).style = centerStyle;
    expReqRow.getCell(8).font = { bold: true };
    
    currentRow += 2;

    // --- SECTION 5: REKAPITULASI ---
    ws.mergeCells(`A${currentRow}:I${currentRow}`);
    ws.getCell(`A${currentRow}`).value = '5. REKAPITULASI NILAI TENAGA AHLI (SKOR AKHIR)';
    ws.getCell(`A${currentRow}`).style = sectionTitleStyle;
    currentRow++;

    ws.getCell(`A${currentRow}`).value = 'Skor Akhir (Total):';
    ws.getCell(`B${currentRow}`).value = result.overallScore;
    ws.getCell(`A${currentRow}`).font = { bold: true };
    ws.getCell(`B${currentRow}`).font = { bold: true, size: 12, color: { argb: 'FFC16C00' } };
    currentRow++;

    ws.getCell(`A${currentRow}`).value = 'Ringkasan:';
    ws.getCell(`A${currentRow}`).font = { bold: true };
    ws.mergeCells(`B${currentRow}:I${currentRow + 2}`);
    ws.getCell(`B${currentRow}`).value = result.summary;
    ws.getCell(`B${currentRow}`).style = bodyStyle;
    currentRow += 3;

    const rekapHeadRow = ws.getRow(currentRow);
    rekapHeadRow.getCell(1).value = "No";
    ws.mergeCells(`B${currentRow}:D${currentRow}`);
    rekapHeadRow.getCell(2).value = "Unsur Yang Dinilai";
    rekapHeadRow.getCell(5).value = "Nilai";
    rekapHeadRow.getCell(6).value = "Bobot";
    rekapHeadRow.getCell(7).value = "Hasil";
    ws.mergeCells(`H${currentRow}:I${currentRow}`);
    rekapHeadRow.getCell(8).value = "Justifikasi";
    rekapHeadRow.eachCell(cell => { if(cell.value) cell.style = tableHeaderStyle('FF424242') });
    currentRow++;

    const rekapStartRow = currentRow;
    result.criteriaScores.forEach((item) => {
      const row = ws.getRow(currentRow);
      row.height = 65;
      row.getCell(1).value = item.no;
      ws.mergeCells(`B${currentRow}:D${currentRow}`);
      row.getCell(2).value = item.name;
      row.getCell(5).value = item.score;
      row.getCell(6).value = item.bobot;
      row.getCell(7).value = item.nilaiAkhir;
      ws.mergeCells(`H${currentRow}:I${currentRow}`);
      const justificationCell = row.getCell(8);
      justificationCell.value = item.justification;
      
      // Explicitly set alignment for the justification cell as wrapText might be lost on merge
      justificationCell.style = bodyStyle;

      row.eachCell((cell, col) => {
        if ([1, 5, 6, 7].includes(col)) {
          cell.style = { ...centerStyle };
          if (col === 6) cell.numFmt = '0%';
        } else if ([2, 8].includes(col)) {
          cell.style = { ...bodyStyle };
        } else {
          cell.style = { ...bodyStyle };
        }
      });
      currentRow++;
    });

    // Add TOTAL ROW for Table 5
    const rekapSumRow = ws.getRow(currentRow);
    ws.mergeCells(`A${currentRow}:F${currentRow}`);
    rekapSumRow.getCell(1).value = "TOTAL SKOR AKHIR ";
    rekapSumRow.getCell(1).style = { ...tableHeaderStyle('FF424242'), alignment: { horizontal: 'right', vertical: 'middle' } };
    rekapSumRow.getCell(7).value = { formula: `SUM(G${rekapStartRow}:G${currentRow - 1})` };
    rekapSumRow.getCell(7).style = { ...centerStyle, font: { bold: true, size: 14 } };
    currentRow++;

    currentRow += 2;
    ws.mergeCells(`A${currentRow}:I${currentRow}`);
    const footer = ws.getCell(`A${currentRow}`);
    footer.value = '--- Dicetak secara otomatis oleh AI ---';
    footer.alignment = { horizontal: 'center' };
    footer.font = { italic: true, size: 8, color: { argb: 'FF888888' } };

    // Final Touch
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `Nilai_${result.personnelName.replace(/\s+/g, "_") || "Personil"}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const { getRootProps: getSelProps, getInputProps: getSelInput, isDragActive: isSelActive } = useDropzone({ 
    onDrop: onDropSelectionDoc, 
    accept: { "application/pdf": [".pdf"] },
    multiple: false
  } as any);

  const { getRootProps: getKakProps, getInputProps: getKakInput, isDragActive: isKakActive } = useDropzone({ 
    onDrop: onDropKakDoc, 
    accept: { "application/pdf": [".pdf"] },
    multiple: false
  } as any);

  const { getRootProps: getQualProps, getInputProps: getQualInput, isDragActive: isQualActive } = useDropzone({ 
    onDrop: onDropQualificationDoc, 
    accept: { "application/pdf": [".pdf"] },
    multiple: false
  } as any);

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827] font-sans selection:bg-blue-100">
      {/* Navigation Header */}
      <nav className="sticky top-0 z-50 bg-[#808000] shadow-lg px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/10 rounded-lg border border-white/20">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white leading-none">Evaluasi Kualifikasi Tenaga Ahli</h1>
              <p className="text-[10px] text-blue-100/70 uppercase tracking-widest font-semibold mt-1">Jasa Konsultansi Konstruksi</p>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="mb-12">
          <h2 className="text-4xl font-extrabold text-gray-900 mb-4">Evaluasi Kualifikasi Tenaga Ahli</h2>
          <p className="text-lg text-gray-600 max-w-2xl leading-relaxed">
            Sistem berbasis AI untuk membantu Pokja Pemilihan mempercepat verifikasi dan penilaian kualifikasi tenaga ahli jasa konsultansi konstruksi.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Upload Card 1: Dokumen Seleksi */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">1</span>
              <h3 className="font-bold text-gray-800 uppercase text-xs tracking-wider">Dokumen Seleksi</h3>
            </div>
            <div 
              {...getSelProps()} 
              className={cn(
                "group relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[300px]",
                isSelActive ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white hover:border-blue-400 hover:bg-gray-50/50",
                selectionDoc.file && "border-green-400 bg-green-50/10"
              )}
            >
              <input {...getSelInput()} />
              {selectionDoc.file ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-100 rounded-2xl inline-block">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 truncate max-w-[200px]">{selectionDoc.file.name}</p>
                    <p className="text-xs text-gray-500 mt-1 uppercase font-semibold">File PDF Dokumen Seleksi</p>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setSelectionDoc({ file: null, text: "" }); }}
                    className="text-red-500 text-xs font-bold hover:underline flex items-center justify-center gap-1 mx-auto"
                  >
                    <Trash2 className="w-3 h-3" /> Hapus File PDF Dokumen Seleksi
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-gray-100 rounded-2xl group-hover:bg-blue-100 transition-colors">
                    <FileUp className="w-10 h-10 text-gray-400 group-hover:text-blue-500" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">Upload Dokumen Seleksi (BAB VI)</p>
                    <p className="text-sm text-gray-500 mt-1 px-4 leading-relaxed">Upload file PDF Dokumen Seleksi atau BAB VI. Lembar Kriteria Evaluasi</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Upload Card 2: Kerangka Acuan Kerja (KAK) */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">2</span>
              <h3 className="font-bold text-gray-800 uppercase text-xs tracking-wider">Kerangka Acuan Kerja (KAK)</h3>
            </div>
            <div 
              {...getKakProps()} 
              className={cn(
                "group relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[300px]",
                isKakActive ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white hover:border-blue-400 hover:bg-gray-50/50",
                kakDoc.file && "border-green-400 bg-green-50/10"
              )}
            >
              <input {...getKakInput()} />
              {kakDoc.file ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-100 rounded-2xl inline-block">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 truncate max-w-[200px]">{kakDoc.file.name}</p>
                    <p className="text-xs text-gray-500 mt-1 uppercase font-semibold">File PDF KAK</p>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setKakDoc({ file: null, text: "" }); }}
                    className="text-red-500 text-xs font-bold hover:underline flex items-center justify-center gap-1 mx-auto"
                  >
                    <Trash2 className="w-3 h-3" /> Hapus File PDF KAK
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-gray-100 rounded-2xl group-hover:bg-blue-100 transition-colors">
                    <FileText className="w-10 h-10 text-gray-400 group-hover:text-blue-500" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">Upload Dokumen KAK</p>
                    <p className="text-sm text-gray-500 mt-1 px-4 leading-relaxed">Upload file PDF KAK yang berisi tabel Kualifikasi Tenaga Ahli yang disusun oleh PPK</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Upload Card 3: Data Kualifikasi Tenaga Ahli */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">3</span>
              <h3 className="font-bold text-gray-800 uppercase text-xs tracking-wider">Data Kualifikasi Tenaga Ahli</h3>
            </div>
            <div 
              {...getQualProps()} 
              className={cn(
                "group relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[300px]",
                isQualActive ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white hover:border-blue-400 hover:bg-gray-50/50",
                qualificationDoc.file && "border-green-400 bg-green-50/10"
              )}
            >
              <input {...getQualInput()} />
              {qualificationDoc.file ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-100 rounded-2xl inline-block">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 truncate max-w-[200px]">{qualificationDoc.file.name}</p>
                    <p className="text-xs text-gray-500 mt-1 uppercase font-semibold">File PDF Data Kualifikasi</p>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setQualificationDoc({ file: null, text: "" }); }}
                    className="text-red-500 text-xs font-bold hover:underline flex items-center justify-center gap-1 mx-auto"
                  >
                    <Trash2 className="w-3 h-3" /> Hapus File PDF Data Kualifikasi
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-gray-100 rounded-2xl group-hover:bg-blue-100 transition-colors">
                    <FileText className="w-10 h-10 text-gray-400 group-hover:text-blue-500" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">Upload Data Kualifikasi Tenaga Ahli</p>
                    <p className="text-sm text-gray-500 mt-1 px-4 leading-relaxed">File PDF berisi CV, Ijazah, SKA/SKK, dan referensi tenaga ahli. Maksimal 75 halaman. HANYA bisa memproses SATU TA per file. </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-8 bg-red-50 border border-red-200 p-4 rounded-2xl flex items-center gap-3 text-red-700"
            >
              <AlertCircle className="w-5 h-5" />
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Button */}
        <div className="mt-12 flex flex-col items-center justify-center gap-6">
          <button
            onClick={handleStartEvaluation}
            disabled={isExtracting || isEvaluating || isCheckingPageCount}
            className={cn(
              "relative px-12 py-5 rounded-2xl font-black text-lg tracking-tight transition-all duration-300 shadow-xl shadow-blue-500/20 active:scale-95 group",
              isExtracting || isEvaluating || isCheckingPageCount ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700 hover:-translate-y-1"
            )}
          >
            <div className="flex items-center gap-3">
              {isExtracting || isEvaluating || isCheckingPageCount ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <div className="flex flex-col items-center">
                    <span>
                      {isCheckingPageCount ? "Mengecek Halaman..." : 
                       isExtracting ? "Mengekstrak Teks..." : "Menganalisis..."}
                    </span>
                    {isEvaluating && processStep && (
                      <span className="text-[10px] uppercase tracking-widest mt-1 opacity-70 font-bold whitespace-nowrap">
                        {processStep}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  <span>Mulai Penilaian</span>
                </>
              )}
            </div>
          </button>
          
          {(isExtracting || isEvaluating || isCheckingPageCount) && (
            <p className="text-sm text-gray-500 animate-pulse font-medium text-center">
              {isCheckingPageCount 
                ? "Sedang mengecek jumlah halaman agar tidak melebihi 75 halaman..." 
                : "Sedang memproses dokumen Anda menggunakan AI..."}
            </p>
          )}
          
          {result && !isEvaluating && !isExtracting && (
            <motion.p 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-green-600 font-bold flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Proses penilaian telah selesai dan berhasil!
            </motion.p>
          )}
        </div>

        {/* Results Section */}
        <AnimatePresence>
          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-24 space-y-12"
            >
              {/* Score Dashboard Header */}
              <div className="bg-white border border-gray-200 rounded-[32px] p-8 md:p-12 shadow-2xl shadow-gray-200/50">
                <div className="flex flex-col md:flex-row items-center gap-12">
                  <div className="relative">
                    <svg className="w-48 h-48 -rotate-90">
                      <circle 
                        cx="96" cy="96" r="88" 
                        stroke="#F3F4F6" strokeWidth="16" fill="transparent" 
                      />
                      <motion.circle 
                        cx="96" cy="96" r="88" 
                        stroke="#2563EB" strokeWidth="16" fill="transparent"
                        strokeDasharray={552}
                        initial={{ strokeDashoffset: 552 }}
                        animate={{ strokeDashoffset: 552 - (552 * result.overallScore) / 100 }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-5xl font-black text-gray-900">{result.overallScore}</span>
                      <span className="text-xs uppercase font-bold text-gray-400 tracking-tighter">Skor Akhir</span>
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-6">
                    <div>
                      <span className="text-xs font-bold text-blue-600 uppercase tracking-[0.2em] mb-2 block">Hasil Analisis AI</span>
                      <h3 className="text-3xl font-black text-gray-900 leading-tight">Nama Personil: {result.personnelName}</h3>
                      <p className="text-lg font-bold text-blue-600 mt-1">Posisi: {result.proposedPosition}</p>
                      <p className="text-gray-500 mt-2 font-medium leading-relaxed">{result.summary}</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <div className="bg-green-50 text-green-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 border border-green-100">
                        <ClipboardCheck className="w-5 h-5" /> Evaluasi Kualifikasi Tenaga Ahli Selesai
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Special Education Table */}
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
                  <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                    Tingkat dan Jurusan Pendidikan
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </h3>
                </div>
                
                <div className="overflow-hidden bg-white border border-gray-200 rounded-3xl shadow-sm">
                  <table className="w-full text-left border-collapse font-sans">
                    <thead>
                      <tr className="bg-blue-50/50 border-b border-gray-200">
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-16">No</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Persyaratan Pendidikan KAK</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Pendidikan TA Ditawarkan</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-20 text-center">Nilai</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-20 text-center">Bobot</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-24 text-center">Nilai Akhir</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Keterangan AI</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="hover:bg-blue-50/20 transition-colors">
                        <td className="px-6 py-6 text-sm font-bold text-gray-400">{result.educationAssessment.no}</td>
                        <td className="px-6 py-6 font-bold text-gray-900 text-sm">{result.educationAssessment.kakRequirement}</td>
                        <td className="px-6 py-6 font-medium text-gray-700 text-sm">{result.educationAssessment.offeredEducation}</td>
                        <td className="px-6 py-6 text-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-50 text-gray-700 font-black border border-gray-100">
                            {result.educationAssessment.score}
                          </span>
                        </td>
                        <td className="px-6 py-6 text-center text-sm font-bold text-gray-500">
                          {(result.educationAssessment.weight * 100).toFixed(0)}%
                        </td>
                        <td className="px-6 py-6 text-center">
                          <span className="inline-flex items-center justify-center w-12 h-10 rounded-lg bg-blue-50 text-blue-700 font-black border border-blue-100">
                            {result.educationAssessment.finalScore.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-6 text-sm text-gray-600 leading-relaxed max-w-xs italic">
                          {result.educationAssessment.aiRemark}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Status Tenaga Ahli Table */}
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
                  <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                    Status Tenaga Ahli
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </h3>
                </div>
                
                <div className="overflow-hidden bg-white border border-gray-200 rounded-3xl shadow-sm">
                  <table className="w-full text-left border-collapse font-sans">
                    <thead>
                      <tr className="bg-blue-50/50 border-b border-gray-200">
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-16">No</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Bukti Potong/Lapor Pajak PPh 21</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Status Tenaga Ahli</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-20 text-center">Nilai</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-20 text-center">Bobot</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-24 text-center">Nilai Akhir</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Keterangan AI</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="hover:bg-blue-50/20 transition-colors">
                        <td className="px-6 py-6 text-sm font-bold text-gray-400">{result.statusAssessment.no}</td>
                        <td className="px-6 py-6 font-bold text-gray-900 text-sm leading-tight">{result.statusAssessment.taxProof}</td>
                        <td className="px-6 py-6 font-medium text-gray-700 text-sm whitespace-nowrap">{result.statusAssessment.employmentStatus}</td>
                        <td className="px-6 py-6 text-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-50 text-gray-700 font-black border border-gray-100">
                            {result.statusAssessment.score}
                          </span>
                        </td>
                        <td className="px-6 py-6 text-center text-sm font-bold text-gray-500">
                          {(result.statusAssessment.weight * 100).toFixed(0)}%
                        </td>
                        <td className="px-6 py-6 text-center">
                          <span className="inline-flex items-center justify-center w-12 h-10 rounded-lg bg-blue-50 text-blue-700 font-black border border-blue-100">
                            {result.statusAssessment.finalScore.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-6 text-sm text-gray-600 leading-relaxed max-w-xs italic">
                          {result.statusAssessment.aiRemark}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Subunsur Lain-lain Table */}
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
                  <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                    Subunsur Lain-lain
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </h3>
                </div>
                
                <div className="overflow-hidden bg-white border border-gray-200 rounded-3xl shadow-sm">
                  <table className="w-full text-left border-collapse font-sans">
                    <thead>
                      <tr className="bg-amber-50/50 border-b border-gray-200">
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-16">No</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Uraian Lain-lain</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Penilaian</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-20 text-center">Nilai</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-20 text-center">Bobot</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-24 text-center">Nilai Akhir</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Keterangan AI</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="hover:bg-amber-50/20 transition-colors">
                        <td className="px-6 py-6 text-sm font-bold text-gray-400">{result.otherSubAssessment.no}</td>
                        <td className="px-6 py-6 font-bold text-gray-900 text-sm">{result.otherSubAssessment.description}</td>
                        <td className="px-6 py-6 font-medium text-gray-700 text-sm">
                          <span className={cn(
                            "px-2 py-1 rounded-md text-[10px] font-bold",
                            result.otherSubAssessment.evaluation === "Memenuhi" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          )}>
                            {result.otherSubAssessment.evaluation}
                          </span>
                        </td>
                        <td className="px-6 py-6 text-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-50 text-gray-700 font-black border border-gray-100">
                            {result.otherSubAssessment.score}
                          </span>
                        </td>
                        <td className="px-6 py-6 text-center text-sm font-bold text-gray-500">
                          {(result.otherSubAssessment.weight * 100).toFixed(0)}%
                        </td>
                        <td className="px-6 py-6 text-center">
                          <span className="inline-flex items-center justify-center w-12 h-10 rounded-lg bg-amber-50 text-amber-700 font-black border border-amber-100">
                            {result.otherSubAssessment.finalScore.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-6 text-sm text-gray-600 leading-relaxed max-w-xs italic">
                          {result.otherSubAssessment.aiRemark}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Experience Assessment Table */}
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
                  <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                    Rincian Pengalaman Kerja Profesional
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </h3>
                </div>
                
                <div className="overflow-hidden bg-white border border-gray-200 rounded-3xl shadow-sm overflow-x-auto">
                  <table className="w-full text-left border-collapse font-sans min-w-[1000px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-12">No</th>
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Tgl Mulai</th>
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Tgl Selesai</th>
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-16 text-center">Bulan</th>
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-16 text-center">Lingkup</th>
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-16 text-center">Posisi</th>
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-16 text-center">Referensi</th>
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider w-20 text-center font-bold text-blue-600">Jumlah</th>
                        <th className="px-4 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Keterangan AI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.experienceAssessment.map((exp, idx) => (
                        <tr key={idx} className="hover:bg-blue-50/20 transition-colors">
                          <td className="px-4 py-4 text-sm font-bold text-gray-400">{exp.no}</td>
                          <td className="px-4 py-4 text-sm font-medium text-gray-700">{formatIndonesianDate(exp.startDate)}</td>
                          <td className="px-4 py-4 text-sm font-medium text-gray-700">{formatIndonesianDate(exp.endDate)}</td>
                          <td className="px-4 py-4 text-center text-sm font-black text-gray-900">{exp.months}</td>
                          <td className="px-4 py-4 text-center text-sm font-bold text-gray-600">{exp.scope}</td>
                          <td className="px-4 py-4 text-center text-sm font-bold text-gray-600">{exp.position}</td>
                          <td className="px-4 py-4 text-center text-sm font-bold text-gray-600">{exp.reference}</td>
                          <td className="px-4 py-4 text-center">
                            <span className="inline-flex items-center justify-center px-2 py-1 rounded bg-blue-50 text-blue-700 font-bold text-xs border border-blue-100">
                              {exp.total.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-500 italic leading-snug max-w-xs">
                            {exp.aiRemark}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Detailed Criteria Table */}
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
                  <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                    Rekapitulasi Hasil Penilaian Tenaga Ahli
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </h3>
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={exportToPDF}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                    >
                      <FileDown className="w-4 h-4 text-red-500" />
                      Export PDF
                    </button>
                    <button 
                      onClick={exportToExcel}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-green-600" />
                      Export Excel
                    </button>
                  </div>
                </div>
                
                <div className="overflow-hidden bg-white border border-gray-200 rounded-3xl shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-6 py-4 text-xs font-black uppercase text-gray-500 tracking-wider w-16">No</th>
                        <th className="px-6 py-4 text-xs font-black uppercase text-gray-500 tracking-wider">Unsur Yang Dinilai</th>
                        <th className="px-6 py-4 text-xs font-black uppercase text-gray-500 tracking-wider w-24 text-center">Nilai</th>
                        <th className="px-6 py-4 text-xs font-black uppercase text-gray-500 tracking-wider w-24 text-center">Bobot</th>
                        <th className="px-6 py-4 text-xs font-black uppercase text-gray-500 tracking-wider w-24 text-center">Nilai Akhir</th>
                        <th className="px-6 py-4 text-xs font-black uppercase text-gray-500 tracking-wider">Keterangan / Justifikasi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.criteriaScores.map((item, idx) => (
                        <motion.tr 
                          key={idx}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="hover:bg-blue-50/30 transition-colors"
                        >
                          <td className="px-6 py-6 text-sm font-bold text-gray-400">{item.no}</td>
                          <td className="px-6 py-6">
                            <p className="font-bold text-gray-900 leading-tight">{item.name}</p>
                          </td>
                          <td className="px-6 py-6 text-center">
                            <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gray-50 text-gray-700 text-lg font-black border border-gray-100">
                              {item.score}
                            </span>
                          </td>
                          <td className="px-6 py-6 text-center">
                            <span className="text-sm font-bold text-gray-500">
                              {(item.bobot * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-6 py-6 text-center">
                            <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-700 text-lg font-black border border-blue-100">
                              {item.nilaiAkhir.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-6 py-6 text-sm text-gray-600 leading-relaxed max-w-md">
                            {item.justification}
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Warning/Footer */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 flex gap-4">
                <AlertCircle className="w-6 h-6 text-yellow-600 shrink-0" />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-yellow-900">Disclaimer bagi Pokja Pemilihan</h4>
                  <p className="text-xs text-yellow-700 leading-relaxed font-medium">
                    Penilaian ini dihasilkan oleh AI untuk membantu proses Evaluasi. Pokja Pemilihan berkewajiban untuk memeriksa ulang setiap butir justifikasi dan referensi dokumen sesuai dengan fakta dalam dokumen asli sebelum menerbitkan penilaian final.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-gray-200">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-gray-400" />
            <span className="text-sm font-bold text-gray-500">© 2026 Pokja Pemilihan UKPBJ DIY</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
