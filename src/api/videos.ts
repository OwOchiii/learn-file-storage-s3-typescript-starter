import {respondWithJSON} from "./json";

import {type ApiConfig} from "../config";
import {type BunRequest} from "bun";
import {getBearerToken, validateJWT} from "../auth.ts";
import {createVideo, getVideo, getVideos, updateVideo} from "../db/videos.ts";
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

    console.log("Detecting video aspect ratio...");
    const videoAspect = await getVideoAspectRadio("tmp.mp4");
    console.log(`Video aspect ratio: ${videoAspect}`);

    console.log("Processing video for fast start...");
    const processedFilePath = await processVideoForFastStart("tmp.mp4");

    const s3Key = `${videoAspect}/${videoId}.mp4`;
    console.log(`Uploading to S3 bucket: ${cfg.s3Bucket}, region: ${cfg.s3Region}, key: ${s3Key}`);
    try {
        const localFile = Bun.file(processedFilePath);
        const s3File = cfg.s3Client.file(s3Key, {
            type: "video/mp4",
            bucket: cfg.s3Bucket,
        });
        await s3File.write(localFile);
        console.log("Upload complete!");
    } catch (error) {
        console.error("S3 upload error:", error);
        await Bun.file("tmp.mp4").unlink();
        await Bun.file(processedFilePath).unlink();
        throw new BadRequestError(`Failed to upload to S3: ${error}`);
    }
    
    console.log("Cleaning up temporary files...");
    await Bun.file("tmp.mp4").unlink();
    await Bun.file(processedFilePath).unlink();


    videoMetaData.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
    updateVideo(cfg.db, videoMetaData);


  return respondWithJSON(200, {"videoURL": videoMetaData.videoURL});
}

export async function getVideoAspectRadio(filePath: string) : Promise<string> {
    const proc = Bun.spawn(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", filePath], {
        stdout: "pipe",
        stderr: "pipe",
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();

    // Wait for process to complete
    await proc.exited;

    if (proc.exitCode !== 0) {
        throw new Error(`ffprobe failed with exit code ${proc.exitCode}: ${stderrText}`);
    }

    const jsonData = JSON.parse(stdoutText);
    const width = jsonData.streams[0].width;
    const height = jsonData.streams[0].height;

    // Calculate aspect ratio from width and height
    const aspectRatio = width / height;

    // Check if it's landscape (16:9 = 1.777...)
    if (aspectRatio > 1.5) {
        return "landscape"
    }
    // Check if it's portrait (9:16 = 0.5625)
    else if (aspectRatio < 0.7) {
        return "portrait"
    }
    else {
        return "other"
    }
}

export async function processVideoForFastStart(inputFilePath: string): Promise<string> {
    const outputFilePath = inputFilePath + ".processed";
    
    console.log(`Processing video for fast start: ${inputFilePath} -> ${outputFilePath}`);
    
    const proc = Bun.spawn([
        "ffmpeg",
        "-i", inputFilePath,
        "-movflags", "faststart",
        "-map_metadata", "0",
        "-codec", "copy",
        "-f", "mp4",
        outputFilePath
    ], {
        stdout: "pipe",
        stderr: "pipe",
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();

    // Wait for process to complete
    await proc.exited;

    if (proc.exitCode !== 0) {
        throw new Error(`ffmpeg failed with exit code ${proc.exitCode}: ${stderrText}`);
    }

    console.log("Video processing complete");
    return outputFilePath;
}

