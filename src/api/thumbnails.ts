import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import {getVideo, updateVideo} from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError } from "./errors";
import * as path from "node:path";
import {randomBytes} from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here

  const formData = await req.formData();
  const thumbnail = formData.get("thumbnail");
  if (!(thumbnail instanceof File)) {
      throw new BadRequestError("Thumbnail file is required");
  }

  const mediaType = thumbnail.type;


  if (mediaType.split("/")[1] !== "jpeg" && mediaType.split("/")[1] !== "png"){
        throw new BadRequestError("Thumbnail file must be a JPEG or PNG image");
  }

  const MAX_THUMBNAIL_SIZE = 10 * 1024 * 1024; // 10 MB
  if (thumbnail.size > MAX_THUMBNAIL_SIZE) {
      throw new BadRequestError("Thumbnail file size exceeds the limit");
  }

  const random = randomBytes(32).toString("base64url");
  const filePaths = path.join(cfg.assetsRoot, random + MEDIA_TYPE_TO_EXTENSION[mediaType] || "");
  await Bun.write(filePaths, thumbnail);


  const videoMeta = getVideo(cfg.db, videoId);

  if (userID !== videoMeta?.userID) {
      throw new BadRequestError("You are not authorized to upload thumbnail for this video");
  }

  const thumbnailURL = `http://localhost:${cfg.port}/assets/${videoId}.${mediaType.split("/")[1]}`;

  videoMeta.thumbnailURL = thumbnailURL;

  updateVideo(cfg.db, videoMeta);

  return respondWithJSON(200, { thumbnailURL: thumbnailURL });

}

const MEDIA_TYPE_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
};