import {respondWithJSON} from "./json";

import {type ApiConfig} from "../config";
import {type BunRequest} from "bun";
import {getBearerToken, validateJWT} from "../auth.ts";
import {createVideo, getVideo, updateVideo} from "../db/videos.ts";
import {BadRequestError, UserForbiddenError} from "./errors.ts";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
    const upload_limit = 1 << 30; // 1GB
    const {videoId}  = req.params as { videoId?: string };
    if (typeof (videoId) !== "string") {
        throw new BadRequestError("Invalid video ID");
    }
    const token = getBearerToken(req.headers);
    const userID = validateJWT(token, cfg.jwtSecret);

    const videoMetaData = getVideo(cfg.db, videoId);
    if (videoMetaData?.userID !== userID) {
        throw new UserForbiddenError("You are not authorized to upload this video");
    }

    const videoFile = (await req.formData()).get("video") as File;
    if (!videoFile) {
        throw new BadRequestError("Video file is required");
    }
    if (videoFile.size > upload_limit) {
        throw new BadRequestError("Video file size exceeds the limit");
    }

    if (videoFile.type !== "video/mp4") {
        throw new BadRequestError("Video file must be a MP4 video");
    }

    console.log("Writing video to temporary file...");
    await Bun.write("tmp.mp4", videoFile);
    console.log(`Temporary file written: ${videoFile.size} bytes`);

    console.log(`Uploading to S3 bucket: ${cfg.s3Bucket}, region: ${cfg.s3Region}, key: ${videoId}.mp4`);
    try {
        const localFile = Bun.file("tmp.mp4");
        const s3File = cfg.s3Client.file(`${videoId}.mp4`, {
            type: "video/mp4",
            bucket: cfg.s3Bucket,
        });
        await s3File.write(localFile);
        console.log("Upload complete!");
    } catch (error) {
        console.error("S3 upload error:", error);
        await Bun.file("tmp.mp4").unlink();
        throw new BadRequestError(`Failed to upload to S3: ${error}`);
    }
    
    console.log("Cleaning up temporary file...");
    await Bun.file("tmp.mp4").unlink();


    videoMetaData.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${videoId}.mp4`;
    updateVideo(cfg.db, videoMetaData);


  return respondWithJSON(200, {"videoURL": videoMetaData.videoURL});
}
