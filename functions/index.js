const functions = require("firebase-functions/v2");
const tesseract = require("tesseract.js");
const PDFDocument = require("pdfkit");
const multipart = require("parse-multipart-data");

exports.convertImageToText = functions.https.onRequest(
	{
		timeoutSeconds: 180, // 9 minutes
		memory: "1GiB", // Increased memory allocation
	},
	async (request, response) => {
		// Enable CORS
		response.set("Access-Control-Allow-Origin", "*");
		response.set("Access-Control-Allow-Methods", "POST");
		response.set("Access-Control-Allow-Headers", "Content-Type");

		// Handle preflight requests
		if (request.method === "OPTIONS") {
			response.status(204).send("");
			return;
		}

		try {
			// Parse multipart form data
			const boundary = multipart.getBoundary(
				request.headers["content-type"] || ""
			);
			if (!boundary) {
				throw new Error("No boundary found in content-type header");
			}

			const parts = multipart.parse(request.body, boundary);
			if (!parts || parts.length === 0) {
				throw new Error("No files uploaded");
			}

			// Filter for image files
			const imageFiles = parts.filter((part) =>
				part.type.startsWith("image/")
			);

			if (imageFiles.length === 0) {
				throw new Error("No valid image files found");
			}

			// Process all images in parallel and store extracted text
			const extractedTexts = await Promise.all(
				imageFiles.map(async (file) => {
					const {
						data: { text },
					} = await tesseract.recognize(file.data, "eng", {
						logger: (info) =>
							console.log(
								"Processing " +
									file.filename +
									": " +
									info.status
							),
					});

					return {
						filename: file.filename || "unknown",
						text: text,
					};
				})
			);

			// Create PDF with all extracted text
			const pdfBuffer = await new Promise((resolve, reject) => {
				const doc = new PDFDocument();
				const chunks = [];

				doc.on("data", (chunk) => chunks.push(chunk));
				doc.on("end", () => resolve(Buffer.concat(chunks)));
				doc.on("error", reject);

				// Add each text block to PDF with filename as header
				extractedTexts.forEach((item, index) => {
					if (index > 0) {
						doc.addPage(); // Add new page for each new document
					}

					// Add filename as header
					doc.fontSize(16)
						.font("Helvetica-Bold")
						.text(`Extracted from: ${item.filename}`, {
							underline: true,
						});

					// Add extracted text
					doc.moveDown()
						.fontSize(12)
						.font("Helvetica")
						.text(item.text, {
							align: "left",
							lineGap: 2,
						});
				});

				doc.end();
			});

			 // Create text file content
            const textContent = extractedTexts
                .map(item => `=== ${item.filename} ===\n\n${item.text}\n\n`)
                .join('---\n\n');

            // Set response headers for JSON
            response.set('Content-Type', 'application/json');

            // Send both files as base64 encoded strings
            response.json({
                pdf: pdfBuffer.toString('base64'),
                text: Buffer.from(textContent).toString('base64')
            });
        } catch (error) {
            console.error("Error:", error);
            response.status(500).json({
                error: "Failed to process images",
                details: error.message,
            });
        }
    }
);
