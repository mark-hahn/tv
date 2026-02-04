import { execFile } from "child_process";
const ASR_BIN = "/usr/local/bin/asr";
const targetPath = "/mnt/media/tv/Let Them Eat Cake/Season 1";

console.log("Testing execFile...");
execFile(ASR_BIN, [targetPath], (error, stdout, stderr) => {
    console.log("Error:", error);
    console.log("Stdout:", stdout);
    console.log("Stderr:", stderr);
});
