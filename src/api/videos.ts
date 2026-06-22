 import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
 import {getBearerToken, validateJWT} from "../auth.ts";
 import {getVideo, getVideos} from "../db/videos.ts";
 import {BadRequestError} from "./errors.ts";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const upload_limit = 1 << 30; // 1GB
  const videoId = req.params as string;
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videoMetaData = getVideo(cfg.db, videoId);
  if (videoMetaData?.userID !== userID) {
    throw new BadRequestError("You are not authorized to upload this video");
  }

  const videoFile = (await req.formData()).get("video") as File;
    if (!videoFile) {
        throw new BadRequestError("Video file is required");
    }
    if (videoFile.size > upload_limit) {
        throw new BadRequestError("Video file size exceeds the limit");
    }

    if(!videoFile.type.startsWith("video/mp4")) {
        throw new BadRequestError("Video file must be a MP4 video");
    }

    


  return respondWithJSON(200, null);
}
