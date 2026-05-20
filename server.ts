import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import multer from "multer";
import dotenv from "dotenv";
dotenv.config();

import { evaluateQualification } from "./src/services/geminiService.ts";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Standard middleware
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Configure multer for file uploads
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // Increased to 50MB for large documents
  });

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // API Route: Extract text from PDF
  app.post("/api/extract-text", (req, res, next) => {
    upload.array("files")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error("[Server] Multer Error:", err);
        return res.status(400).json({ error: "File upload error", message: err.message });
      } else if (err) {
        console.error("[Server] Unknown Upload Error:", err);
        return res.status(500).json({ error: "Upload failed", message: err.message });
      }
      next();
    });
  }, async (req: any, res) => {
    try {
      const files = req.files as any[];
      if (!files || files.length === 0) {
        console.warn("[Server] No files found in req.files.");
        return res.status(400).json({ error: "No files uploaded", message: "Mohon pilih file PDF untuk diunggah" });
      }

      console.log(`[Server] Processing extraction for ${files.length} files`);
      const memBefore = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`[Server] Memory before extraction: ${memBefore}MB`);

      const results = [];
      
      // Process sequentially to avoid memory spikes with multiple large PDFs
      for (const file of files) {
        try {
          console.log(`[Server] Parsing: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
          
          if (typeof pdf !== "function") {
             throw new Error("Layanan pembaca PDF sedang tidak tersedia. Mohon coba sesaat lagi.");
          }

          // Use standard pdf-parse API (pdf is a function)
          const data = await pdf(file.buffer);
          const text = data?.text || "";
          
          results.push({
            name: file.originalname,
            text: text
          });
          console.log(`[Server] Successfully extracted ${text.length} chars from ${file.originalname}`);
        } catch (fileErr: any) {
          console.error(`[Server] Extraction FAILED for ${file.originalname}:`, fileErr);
          results.push({ 
            name: file.originalname, 
            text: `[ERROR_EXTRACTION_FAILED: ${file.originalname} | Reason: ${fileErr?.message || "Format tidak didukung"}]` 
          });
        }
      }

      const memAfter = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`[Server] Memory after extraction: ${memAfter}MB (Diff: ${memAfter - memBefore}MB)`);

      return res.status(200).json(results);
    } catch (error: any) {
      console.error("[Server] Critical Extraction Error:", error);
      return res.status(500).json({ 
        error: "Terjadi kesalahan saat mengekstrak teks PDF",
        message: error?.message || "Kesalahan internal server"
      });
    }
  });

  // API Route: Evaluate Qualification Multimodally (Opsi A)
  app.post("/api/evaluate", (req, res, next) => {
    upload.fields([
      { name: "selectionDoc", maxCount: 1 },
      { name: "kakDoc", maxCount: 1 },
      { name: "qualificationDoc", maxCount: 1 }
    ])(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error("[Server] Multer Error:", err);
        return res.status(400).json({ error: "File upload error", message: err.message });
      } else if (err) {
        console.error("[Server] Unknown Upload Error:", err);
        return res.status(500).json({ error: "Upload failed", message: err.message });
      }
      next();
    });
  }, async (req: any, res) => {
    // Set up chunked streaming
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const files = req.files as any;
      const selectionFile = files?.["selectionDoc"]?.[0];
      const kakFile = files?.["kakDoc"]?.[0];
      const qualificationFile = files?.["qualificationDoc"]?.[0];

      if (!selectionFile || !kakFile || !qualificationFile) {
        res.write(JSON.stringify({ 
          status: "error", 
          message: "Ketiga dokumen berkas harus lengkap diunggah." 
        }) + "\n");
        return res.end();
      }

      console.log(`[Server] Evaluating: ${selectionFile.originalname}, ${kakFile.originalname}, ${qualificationFile.originalname}`);
      
      res.write(JSON.stringify({ 
        status: "progress", 
        message: "Mengekstrak teks digital dari berkas-berkas PDF..." 
      }) + "\n");

      // Extract text content from buffer for fallback reference
      let selectionText = "";
      let kakText = "";
      let qualificationText = "";

      try {
        const p1 = pdf(selectionFile.buffer).then((d: any) => d?.text || "");
        const p2 = pdf(kakFile.buffer).then((d: any) => d?.text || "");
        const p3 = pdf(qualificationFile.buffer).then((d: any) => d?.text || "");
        
        const textResults = await Promise.all([p1, p2, p3]);
        selectionText = textResults[0];
        kakText = textResults[1];
        qualificationText = textResults[2];
      } catch (pdfErr) {
        console.warn("[Server] Warn: Failed to parse native text from one or more PDF buffers. Gemini will fallback to visual PDF natively.", pdfErr);
      }

      const base64Selection = selectionFile.buffer.toString("base64");
      const base64Kak = kakFile.buffer.toString("base64");
      const base64Qual = qualificationFile.buffer.toString("base64");

      const result = await evaluateQualification(
        { text: selectionText, base64: base64Selection },
        { text: kakText, base64: base64Kak },
        { text: qualificationText, base64: base64Qual },
        (step) => {
          res.write(JSON.stringify({ status: "progress", message: step }) + "\n");
        }
      );

      res.write(JSON.stringify({ status: "success", result }) + "\n");
      res.end();
    } catch (err: any) {
      console.error("[Server] Evaluation failed:", err);
      res.write(JSON.stringify({ 
        status: "error", 
        message: err.message || "Terjadi kesalahan internal saat mengevaluasi kualifikasi." 
      }) + "\n");
      res.end();
    }
  });

  // Global Error Handler for Express
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("[Server] Unhandled Express Error:", err);
    res.status(500).json({ 
      error: "General Server Error", 
      message: err.message 
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
