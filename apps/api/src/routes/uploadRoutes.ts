import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  CardImageUploadRequest,
  CardImageUploadResponse
} from "@collection-tool/shared";
import type { FastifyInstance } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";

const allowedMimeTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

const routeBodyLimit = 10 * 1024 * 1024;

export async function registerUploadRoutes(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase
) {
  app.post(
    "/api/uploads/card-image",
    { bodyLimit: Math.max(routeBodyLimit, config.maxImageUploadBytes * 2) },
    async (request, reply): Promise<CardImageUploadResponse | { error: string }> => {
      const auth = getAuthContext(request, database);

      if (!auth) {
        reply.code(401);
        return { error: "Unauthorized" };
      }

      const input = normalizeUploadInput(request.body as CardImageUploadRequest, config);
      const role = getCollectionRole(database, input.collectionId, auth.user.id);

      if (!role || role === "viewer") {
        reply.code(403);
        return { error: "You need editor access to upload card images." };
      }

      const extension = allowedMimeTypes.get(input.mimeType);

      if (!extension) {
        throw new Error("Card images must be JPEG, PNG, WEBP, or GIF files.");
      }

      const imageBytes = Buffer.from(input.dataBase64, "base64");

      if (imageBytes.byteLength > config.maxImageUploadBytes) {
        throw new Error("Card image is too large.");
      }

      const imageDirectory = join(config.uploadsPath, "card-images");
      const fileName = `${randomUUID()}.${extension}`;
      const filePath = join(imageDirectory, fileName);

      await mkdir(imageDirectory, { recursive: true });
      await writeFile(filePath, imageBytes, { flag: "wx" });

      reply.code(201);
      return {
        imageUrl: `/uploads/card-images/${fileName}`
      };
    }
  );

  app.get("/uploads/card-images/:fileName", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const { fileName } = request.params as { fileName: string };
    const safeFileName = basename(fileName);

    if (safeFileName !== fileName) {
      reply.code(400);
      return { error: "Invalid image path." };
    }

    const extension = safeFileName.split(".").pop()?.toLowerCase();
    const mimeType = mimeTypeForExtension(extension);

    if (!mimeType) {
      reply.code(404);
      return { error: "Image not found." };
    }

    const filePath = join(config.uploadsPath, "card-images", safeFileName);

    try {
      await access(filePath);
    } catch {
      reply.code(404);
      return { error: "Image not found." };
    }

    reply.type(mimeType);
    return reply.send(createReadStream(filePath));
  });
}

function normalizeUploadInput(input: CardImageUploadRequest, config: AppConfig) {
  const collectionId = input.collectionId?.trim();
  const fileName = input.fileName?.trim();
  const mimeType = input.mimeType?.trim().toLowerCase();
  const dataBase64 = input.dataBase64?.trim();

  if (!collectionId) {
    throw new Error("A collection is required for image uploads.");
  }

  if (!fileName) {
    throw new Error("Choose an image file to upload.");
  }

  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error("Card images must be JPEG, PNG, WEBP, or GIF files.");
  }

  if (!dataBase64) {
    throw new Error("Image upload data is missing.");
  }

  const estimatedBytes = Math.ceil((dataBase64.length * 3) / 4);

  if (estimatedBytes > config.maxImageUploadBytes) {
    throw new Error("Card image is too large.");
  }

  return {
    collectionId,
    fileName,
    mimeType,
    dataBase64
  };
}

function mimeTypeForExtension(extension: string | undefined) {
  for (const [mimeType, candidateExtension] of allowedMimeTypes) {
    if (candidateExtension === extension) {
      return mimeType;
    }
  }

  return null;
}
